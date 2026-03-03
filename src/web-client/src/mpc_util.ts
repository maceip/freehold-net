// MPC Utility functions for OpenPetition
export function convertBytesToBits(byte_string: Uint8Array): boolean[] {
  const binary_array: boolean[] = [];
  for (const x of byte_string) {
    const bits = x.toString(2).padStart(8, '0');
    for (const b of bits) {
      binary_array.push(b === '1');
    }
  }
  return binary_array;
}

export function generateXorShares(input_bits: boolean[], num_parties: number = 5): boolean[][] {
  const len = input_bits.length;
  const shares: boolean[][] = Array.from({ length: num_parties }, () => []);
  let current_xor = [...input_bits];

  for (let i = 1; i < num_parties; i++) {
    const randomArray = new Uint8Array(len);
    crypto.getRandomValues(randomArray);
    const share_i = Array.from(randomArray).map(val => (val % 2) === 0);
    shares[i] = share_i;
    current_xor = current_xor.map((x, idx) => x !== share_i[idx]);
  }
  shares[0] = current_xor;
  return shares;
}

export function bitsToB64(bits: boolean[]): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      bytes[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }
  return btoa(String.fromCharCode(...bytes));
}
