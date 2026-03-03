//! Freehold Bridge for OpenPetition
//!
//! Registers each local MPC service with the Freehold anycast relay so they
//! become reachable from the public internet without manual port-forwarding.
//!
//! Each service gets its own `Service` instance (Engine + H3 proxy) sharing
//! the relay connection.  Traffic arriving at the relay is proxied back to
//! the local backend port via QUIC/H3.

use anyhow::{Context, Result};
use clap::Parser;
use freehold_client_core::{
    generate_self_signed_cert, Service, ServiceConfig, StatusUpdate,
};
use std::net::SocketAddr;
use tokio::sync::{mpsc, watch};
use tracing::{info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A local backend service to expose through Freehold.
struct Backend {
    name: &'static str,
    local_addr: SocketAddr,
    relay_port: u16,
    h3_bind_port: u16,
}

#[derive(Parser)]
#[command(
    name = "freehold-bridge",
    about = "Expose OpenPetition MPC services through Freehold relay"
)]
struct Args {
    /// Relay server address
    #[clap(short, long, default_value = "freehold.lit.app:9999")]
    relay: String,

    /// Discovery server port (local)
    #[clap(long, default_value = "5880")]
    discovery_port: u16,

    /// MPC server port (local)
    #[clap(long, default_value = "5871")]
    mpc_port: u16,

    /// SMTP forwarder port (local)
    #[clap(long, default_value = "5870")]
    forwarder_port: u16,

    /// Vite dev server port (local)
    #[clap(long, default_value = "5173")]
    web_port: u16,

    /// Domain name for self-signed certificates
    #[clap(long, default_value = "localhost")]
    domain: String,

    /// Party ID of the MPC node (used when announcing to discovery)
    #[clap(long, env = "MPC_PARTY_ID")]
    party_id: Option<u32>,

    /// Write assigned subdomains to this directory (one file per service)
    #[clap(long, default_value = ".freehold")]
    dns_dir: String,
}

/// Announce the MPC node's public hostname to the local discovery server.
/// Called when Freehold assigns a subdomain to the mpc-node service.
async fn announce_to_discovery_async(
    discovery_port: u16,
    party_id: u32,
    mpc_port: u16,
    hostname: &str,
) {
    let url = format!("http://127.0.0.1:{}/announce", discovery_port);
    let body = format!(
        r#"{{"party_id":{},"port":{},"hostname":"{}","status":"online"}}"#,
        party_id, mpc_port, hostname
    );

    // Use a raw TCP connection to POST (avoids pulling in reqwest)
    let addr = format!("127.0.0.1:{}", discovery_port);
    match tokio::net::TcpStream::connect(&addr).await {
        Ok(mut stream) => {
            use tokio::io::AsyncWriteExt;
            let request = format!(
                "POST /announce HTTP/1.1\r\n\
                 Host: 127.0.0.1:{}\r\n\
                 Content-Type: application/json\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\
                 \r\n\
                 {}",
                discovery_port,
                body.len(),
                body
            );
            if let Err(e) = stream.write_all(request.as_bytes()).await {
                warn!("Discovery announce failed: {}", e);
            } else {
                info!(
                    "Announced to discovery: party={} host={} port={}",
                    party_id, hostname, mpc_port
                );
            }
        }
        Err(e) => {
            warn!("Could not reach discovery server at {}: {}", addr, e);
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("freehold_bridge=info,freehold_client_core=info,freehold_h3_proxy=info")
        .init();

    let args = Args::parse();

    let relay_addr: SocketAddr = tokio::net::lookup_host(&args.relay)
        .await
        .context("resolve relay")?
        .next()
        .context("no address for relay")?;

    info!("Relay: {} ({})", args.relay, relay_addr);

    let backends = vec![
        Backend {
            name: "discovery",
            local_addr: SocketAddr::from(([127, 0, 0, 1], args.discovery_port)),
            relay_port: args.discovery_port,
            h3_bind_port: 0, // OS-assigned
        },
        Backend {
            name: "mpc-node",
            local_addr: SocketAddr::from(([127, 0, 0, 1], args.mpc_port)),
            relay_port: args.mpc_port,
            h3_bind_port: 0,
        },
        Backend {
            name: "forwarder",
            local_addr: SocketAddr::from(([127, 0, 0, 1], args.forwarder_port)),
            relay_port: args.forwarder_port,
            h3_bind_port: 0,
        },
        Backend {
            name: "web",
            local_addr: SocketAddr::from(([127, 0, 0, 1], args.web_port)),
            relay_port: args.web_port,
            h3_bind_port: 0,
        },
    ];

    // Shared shutdown
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Shutting down all bridges...");
        let _ = shutdown_tx.send(true);
    });

    // Track assigned subdomains so other components can read them
    let subdomains: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

    // Create dns_dir for subdomain files
    let dns_dir = args.dns_dir.clone();
    std::fs::create_dir_all(&dns_dir).ok();

    let mut handles = Vec::new();

    for backend in backends {
        let (status_tx, mut status_rx) = mpsc::channel::<StatusUpdate>(64);
        let service_name = backend.name;

        // Generate self-signed cert per service
        let (certs, key) = generate_self_signed_cert(&[args.domain.as_str()])?;

        let config = ServiceConfig {
            relay: relay_addr,
            relay_port: backend.relay_port,
            h3_bind: SocketAddr::from(([0, 0, 0, 0], backend.h3_bind_port)),
            backend: backend.local_addr,
            certs,
            key,
            auto_discover: true,
            acme_cache_dir: None,
            dns_zone: None,
        };

        let service = Service::new(config, status_tx)
            .with_context(|| format!("create service for {}", service_name))?;

        let rx = shutdown_rx.clone();
        let subdomains = subdomains.clone();
        let dns_dir = dns_dir.clone();
        let discovery_port = args.discovery_port;
        let party_id = args.party_id;
        let mpc_port = args.mpc_port;

        // Log status updates per service
        tokio::spawn(async move {
            while let Some(update) = status_rx.recv().await {
                match &update {
                    StatusUpdate::RelayState { addr, state } => {
                        info!("[{}] relay {} -> {:?}", service_name, addr, state);
                    }
                    StatusUpdate::SubdomainAssigned(sub) => {
                        info!("[{}] public DNS: {}", service_name, sub);

                        // Write subdomain to file so other processes can read it
                        let path = format!("{}/{}.dns", dns_dir, service_name);
                        if let Err(e) = std::fs::write(&path, sub) {
                            warn!("[{}] failed to write DNS file: {}", service_name, e);
                        }

                        // Track it
                        subdomains.lock().await.insert(service_name.to_string(), sub.clone());

                        // If this is the mpc-node service, announce to discovery
                        if service_name == "mpc-node" {
                            if let Some(pid) = party_id {
                                announce_to_discovery_async(
                                    discovery_port, pid, mpc_port, sub,
                                ).await;
                            }
                        }
                    }
                    StatusUpdate::NeighborDiscovered(ip) => {
                        info!("[{}] neighbor: {}", service_name, ip);
                    }
                    StatusUpdate::Error(e) => {
                        warn!("[{}] error: {}", service_name, e);
                    }
                    _ => {}
                }
            }
        });

        handles.push(tokio::spawn(async move {
            if let Err(e) = service.run(rx).await {
                warn!("[{}] service exited: {}", service_name, e);
            }
        }));

        info!(
            "[{}] registering on relay port {} -> backend {}",
            backend.name, backend.relay_port, backend.local_addr
        );
    }

    // Wait for all services
    for h in handles {
        let _ = h.await;
    }

    Ok(())
}
