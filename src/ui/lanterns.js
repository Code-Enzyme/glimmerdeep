// Lantern styles (SPEC section 24): cosmetic colours for Wren's lantern, unlocked with star moss. Which styles
// exist, their colours, when they unlock and which one is in use. No DOM, so it can be tested in Node.

const halo = (inner, mid, outer) => ({ inner, mid, outer });

// In order of the star moss they need. Counts are [PLACEHOLDER - PLAYTEST].
// glass: the lit glass, centre to edge; rim: its outline; flame; glow: the glass's soft shadow;
// halo: the round glow about the lantern (r, g, b at its middle, half way and edge); light: the warm colour over lit tiles.
export const LANTERNS = [
  {
    id: 'tallow', name: 'Tallow', moss: 0,
    note: 'The lamplighters\' own honest amber, carried up from Wickmoor for generations.',
    glass: ['#FFF8DA', '#FFDB8E', '#F2B04C', '#C27632'], rim: '#8A4E22', flame: '#FFFDF0', glow: '#F2B04C',
    halo: halo([255, 226, 160], [250, 190, 96], [242, 150, 60]), light: [255, 190, 104],
  },
  {
    id: 'mossglow', name: 'Mossglow', moss: 30,
    note: 'Tinted with Mossmouth moss. The Fluffmoths seem to like it best.',
    glass: ['#F2FFF4', '#B8F0CF', '#5FBFA8', '#2F7E6A'], rim: '#245A4C', flame: '#F6FFF8', glow: '#5FBFA8',
    halo: halo([190, 255, 220], [120, 220, 170], [70, 180, 140]), light: [150, 230, 180],
  },
  {
    id: 'emberrose', name: 'Ember rose', moss: 60,
    note: 'A rosy glass, as warm as an Emberwick that has only just caught.',
    glass: ['#FFF1EC', '#FFC2B4', '#E8866A', '#A64B45'], rim: '#7A3030', flame: '#FFF7F2', glow: '#E8866A',
    halo: halo([255, 210, 195], [245, 150, 130], [220, 110, 100]), light: [255, 165, 145],
  },
  {
    id: 'moonglass', name: 'Moonglass', moss: 100,
    note: 'Pale and cool, like the night sky Wren has not seen for days.',
    glass: ['#F6FAFF', '#CFE2FF', '#9CC2F0', '#5577A8'], rim: '#3A5078', flame: '#FFFFFF', glow: '#9CC2F0',
    halo: halo([220, 235, 255], [170, 200, 245], [120, 160, 220]), light: [195, 215, 255],
  },
  {
    id: 'heartroot', name: 'Heartroot', moss: 150,
    note: 'Deep gold, the colour of the Heartroot when it glows gently.',
    glass: ['#FFFBE0', '#FFE58A', '#F0B830', '#A86E14'], rim: '#704810', flame: '#FFFDE8', glow: '#F0B830',
    halo: halo([255, 236, 150], [250, 200, 70], [230, 160, 40]), light: [255, 212, 100],
  },
  {
    id: 'gloamlight', name: 'Gloamlight', moss: 200,
    note: 'A soft violet, gentle enough that even a Gloamling might come close.',
    glass: ['#F8F0FF', '#DCC6FF', '#B08AF0', '#6A4AA8'], rim: '#4A3278', flame: '#FCF8FF', glow: '#B08AF0',
    halo: halo([230, 210, 255], [190, 160, 250], [150, 110, 230]), light: [205, 175, 255],
  },
];

export const DEFAULT_LANTERN = 'tallow';
const NOTE_MAX = 100;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

export function lanternById(id) {
  return LANTERNS.find((l) => l.id === id) || null;
}

// A saved choice -> a known style id, else Tallow's.
export function readLantern(value) {
  return typeof value === 'string' && lanternById(value) ? value : DEFAULT_LANTERN;
}

// Every star moss in the save's level records (the chapters and the Night Garden; the Daily Glimmer keeps its own).
export function starMoss(save) {
  let moss = 0;
  for (const id of Object.keys((save && save.levels) || {})) moss += Number(save.levels[id].stars) || 0;
  return moss;
}

// Unlocked while the star moss is at least the style's count. Unlock all never unlocks a style.
export function isUnlocked(style, save) {
  return !!style && starMoss(save) >= style.moss;
}

// The chosen style while it is unlocked, else Tallow.
export function lanternInUse(save) {
  const chosen = lanternById(readLantern(save && save.settings && save.settings.lantern));
  return isUnlocked(chosen, save) ? chosen : lanternById(DEFAULT_LANTERN);
}

// Lists what breaks the text rules (SPEC sections 13 and 24). -> [] when all is well.
export function checkLanterns(styles = LANTERNS) {
  const problems = [];
  for (const l of styles) {
    if (typeof l.note !== 'string' || !l.note) {
      problems.push(`${l.id} has no note`);
      continue;
    }
    if (l.note.length > NOTE_MAX) problems.push(`${l.id} note is ${l.note.length} characters (at most ${NOTE_MAX})`);
    const m = GENDERED.exec(l.note);
    if (m) problems.push(`${l.id} note uses "${m[0]}"`);
  }
  return problems;
}
