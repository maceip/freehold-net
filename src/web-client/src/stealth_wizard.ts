// OpenPetition Stealth Wizard: SaaS Integration Guides
const saasGuides = {
  slack: {
    title: "Slack Private Integration",
    steps: [
      "Open your Slack Workspace.",
      "Go to 'Apps' > 'Browse' and create a private 'MPC-Identity' app.",
      "Copy the Incoming Webhook URL provided by Slack.",
      "We will deliver codes directly to your private channel."
    ]
  },
  teams: {
    title: "MS Teams Workflow",
    steps: [
      "Open the 'Workflows' app in Teams.",
      "Select 'Post to channel when webhook is received'.",
      "Set channel to 'Private'.",
      "Copy the Workflow URL. Delivery will mimic a standard Teams Bot alert."
    ]
  },
  notion: {
    title: "Notion Identity Page",
    steps: [
      "Create a private page titled 'System Logs'.",
      "Add an 'MPC-Auth' connection via the Notion API.",
      "Codes will appear as new database entries, invisible to IT email filters."
    ]
  }
};

const updateGuide = (type: string) => {
  const guide = saasGuides[type as keyof typeof saasGuides];
  const guideEl = document.getElementById('integration-guide')!;
  guideEl.innerHTML = `
    <h4>${guide.title}</h4>
    <ol style="font-size: 0.85rem; text-align: left; padding-left: 1.5rem;">
      ${guide.steps.map(s => `<li>${s}</li>`).join('')}
    </ol>
  `;
};

// Update existing main.ts logic to include the guide switcher
document.querySelectorAll('.delivery-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const type = (opt as HTMLElement).dataset.type;
    if (type && saasGuides[type as keyof typeof saasGuides]) {
      updateGuide(type);
      document.getElementById('integration-guide')!.style.display = 'block';
    } else {
      document.getElementById('integration-guide')!.style.display = 'none';
    }
  });
});
