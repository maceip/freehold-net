// 100 curated color triplets [primary, secondary, accent]
// Used by background.ts for pattern rendering and by the page for theming
// Each triplet works on dark backgrounds; lighter values serve as accent/highlight

export const PALETTES: [string, string, string][] = [
  // ── Forests & Greens (1–10) ───────────────────────────────────────────────
  ['#2d6a4f', '#52b788', '#95d5b2'],
  ['#1b4332', '#40916c', '#b7e4c7'],
  ['#344e41', '#588157', '#a3b18a'],
  ['#1a2e1a', '#3a5a40', '#dad7cd'],
  ['#0b3d2c', '#1f7a5c', '#6fcf97'],
  ['#0d4f3c', '#27ae60', '#82e0aa'],
  ['#145a32', '#239b56', '#82e0aa'],
  ['#186a3b', '#28b463', '#abebc6'],
  ['#0e6655', '#17a589', '#76d7c4'],
  ['#117a65', '#148f77', '#73c6b6'],

  // ── Oceans & Blues (11–20) ────────────────────────────────────────────────
  ['#1d3557', '#457b9d', '#a8dadc'],
  ['#0d1b2a', '#1b263b', '#778da9'],
  ['#14213d', '#354f6e', '#7d95af'],
  ['#0a1128', '#1e3a5c', '#b0c4de'],
  ['#003049', '#0077b6', '#90e0ef'],
  ['#023e8a', '#0096c7', '#ade8f4'],
  ['#1a237e', '#283593', '#7986cb'],
  ['#0d47a1', '#1976d2', '#64b5f6'],
  ['#01579b', '#0288d1', '#4fc3f7'],
  ['#004d6e', '#0089a7', '#70d6e3'],

  // ── Dusk & Purples (21–30) ────────────────────────────────────────────────
  ['#5a189a', '#7b2cbf', '#c77dff'],
  ['#3c096c', '#5a189a', '#9d4edd'],
  ['#4a0e4e', '#81177d', '#c06fbd'],
  ['#2d0030', '#5c1760', '#e8a8e0'],
  ['#4a148c', '#7b1fa2', '#ce93d8'],
  ['#311b92', '#512da8', '#b39ddb'],
  ['#4527a0', '#5e35b1', '#b388ff'],
  ['#38006b', '#6a1b9a', '#ab47bc'],
  ['#1a0033', '#4b0082', '#9370db'],
  ['#2e003e', '#590072', '#c585e0'],

  // ── Embers & Reds (31–40) ─────────────────────────────────────────────────
  ['#6a040f', '#9d0208', '#dc2f02'],
  ['#370617', '#6a040f', '#e85d04'],
  ['#7b0000', '#b71c1c', '#ef5350'],
  ['#4a0000', '#8b0000', '#ff6b6b'],
  ['#b71c1c', '#d32f2f', '#ef9a9a'],
  ['#880e4f', '#c2185b', '#f48fb1'],
  ['#6e0519', '#a10835', '#e74c3c'],
  ['#5c1010', '#922020', '#e05252'],
  ['#8b1a1a', '#cd3333', '#ff7070'],
  ['#611515', '#9b2335', '#e8505b'],

  // ── Slates & Grays (41–50) ────────────────────────────────────────────────
  ['#343a40', '#6c757d', '#adb5bd'],
  ['#212529', '#495057', '#ced4da'],
  ['#2c3e50', '#536878', '#95a5a6'],
  ['#1c2833', '#2c3e50', '#85929e'],
  ['#17202a', '#2c3e50', '#aab7b8'],
  ['#263238', '#455a64', '#90a4ae'],
  ['#37474f', '#546e7a', '#b0bec5'],
  ['#1b2631', '#34495e', '#7f8c8d'],
  ['#2d2d2d', '#555555', '#999999'],
  ['#3d3d3d', '#6b6b6b', '#a8a8a8'],

  // ── Sage & Earth (51–60) ──────────────────────────────────────────────────
  ['#3e2723', '#5d4037', '#a1887f'],
  ['#4e342e', '#6d4c41', '#bcaaa4'],
  ['#33691e', '#558b2f', '#9ccc65'],
  ['#2e4600', '#486b00', '#a2c523'],
  ['#5d4e37', '#8d6e4b', '#c4a882'],
  ['#3b2f2f', '#6b4f4f', '#a68b8b'],
  ['#4b3621', '#7b5b3a', '#c49a6c'],
  ['#556b2f', '#6b8e23', '#9acd32'],
  ['#4a5d23', '#6b7b3a', '#a8b86d'],
  ['#5e503f', '#847a6d', '#c2b9a7'],

  // ── Plums & Wine (61–70) ──────────────────────────────────────────────────
  ['#4a0e4e', '#81177d', '#c06fbd'],
  ['#2d0030', '#5c1760', '#e8a8e0'],
  ['#3c1361', '#6c3483', '#af7ac5'],
  ['#512e5f', '#76448a', '#c39bd3'],
  ['#6c3461', '#9b4d8e', '#d4a0c7'],
  ['#441650', '#6e2272', '#b561a7'],
  ['#3d0c45', '#6a1b6e', '#c57dd0'],
  ['#5b2c6f', '#7d3c98', '#bb8fce'],
  ['#4a1942', '#7b2d5f', '#c97da8'],
  ['#581845', '#900c3f', '#c70039'],

  // ── Steel & Navy (71–80) ──────────────────────────────────────────────────
  ['#14213d', '#354f6e', '#7d95af'],
  ['#0a1128', '#1e3a5c', '#b0c4de'],
  ['#1b2a4a', '#2c4a7c', '#6b8db5'],
  ['#0f1d36', '#253d5b', '#5a7fa0'],
  ['#1a2744', '#2b4570', '#5c7ea3'],
  ['#0c1929', '#1d3041', '#4d7298'],
  ['#152238', '#283f5b', '#5a7ea4'],
  ['#1a2640', '#2d4466', '#6d8fbb'],
  ['#0e1a2b', '#1f3347', '#4e7da8'],
  ['#162032', '#2a3d58', '#608ab5'],

  // ── Amber & Gold (81–90) ──────────────────────────────────────────────────
  ['#7b5e00', '#b8860b', '#ffd700'],
  ['#8b6914', '#d4a017', '#ffdb58'],
  ['#6d4c00', '#a67c00', '#f0c040'],
  ['#5c4813', '#8a6d2a', '#daa520'],
  ['#704214', '#a0612a', '#e0943a'],
  ['#7e5109', '#b9770e', '#f4d03f'],
  ['#6e5600', '#a88600', '#e8c520'],
  ['#8c6d1f', '#c49b30', '#ffd966'],
  ['#7a5e2a', '#a88040', '#d4a86a'],
  ['#695200', '#9c7e00', '#d4b300'],

  // ── Teal & Cyan (91–100) ──────────────────────────────────────────────────
  ['#004d40', '#00796b', '#4db6ac'],
  ['#00363a', '#006064', '#80deea'],
  ['#005c5c', '#008080', '#66cccc'],
  ['#003838', '#006666', '#5cadad'],
  ['#004040', '#007070', '#50b8b8'],
  ['#00494d', '#007c82', '#4dc9c9'],
  ['#003d3d', '#006b6b', '#5aafaf'],
  ['#004848', '#007878', '#58bcbc'],
  ['#005050', '#008585', '#62c8c8'],
  ['#003535', '#005e5e', '#4fa3a3'],
];

export const PALETTE_NAMES = [
  'Forest','Moss','Sage','Fern','Emerald','Jade','Malachite','Verdant','Teal Pine','Patina',
  'Ocean','Midnight','Navy','Abyss','Marine','Cerulean','Indigo','Cobalt','Azure','Deep Sea',
  'Dusk','Violet','Plum','Orchid','Amethyst','Royale','Iris','Helio','Mystic','Twilight',
  'Ember','Inferno','Crimson','Blood','Rose','Cerise','Garnet','Scarlet','Vermilion','Cherry',
  'Slate','Charcoal','Graphite','Obsidian','Basalt','Pewter','Iron','Storm','Carbon','Ash',
  'Umber','Walnut','Olive','Moss Oak','Camel','Mauve Earth','Sienna','Chartreuse','Pistachio','Sandstone',
  'Wine','Aubergine','Mulberry','Damson','Grape','Maroon','Raisin','Boysen','Cranberry','Burgundy',
  'Steel','Gunmetal','Ink','Shadow','Denim','Harbor','Baltic','Lapis','Deep Cove','Starlight',
  'Amber','Honey','Topaz','Wheat','Bronze','Saffron','Marigold','Buttercup','Brass','Goldenrod',
  'Lagoon','Petrol','Seaglass','Mermaid','Aqua','Tropics','Reef','Capri','Seafoam','Spruce',
];
