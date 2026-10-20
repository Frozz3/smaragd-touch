import { CHARMAP } from './charmap.js';

// Automatisch erzeugt aus src/data/text/move_names.h (englische Spielfassung)
export const MOVE_NAMES = ["-", "POUND", "KARATE CHOP", "DOUBLESLAP", "COMET PUNCH", "MEGA PUNCH", "PAY DAY", "FIRE PUNCH", "ICE PUNCH", "THUNDERPUNCH", "SCRATCH", "VICEGRIP", "GUILLOTINE", "RAZOR WIND", "SWORDS DANCE", "CUT", "GUST", "WING ATTACK", "WHIRLWIND", "FLY", "BIND", "SLAM", "VINE WHIP", "STOMP", "DOUBLE KICK", "MEGA KICK", "JUMP KICK", "ROLLING KICK", "SAND-ATTACK", "HEADBUTT", "HORN ATTACK", "FURY ATTACK", "HORN DRILL", "TACKLE", "BODY SLAM", "WRAP", "TAKE DOWN", "THRASH", "DOUBLE-EDGE", "TAIL WHIP", "POISON STING", "TWINEEDLE", "PIN MISSILE", "LEER", "BITE", "GROWL", "ROAR", "SING", "SUPERSONIC", "SONICBOOM", "DISABLE", "ACID", "EMBER", "FLAMETHROWER", "MIST", "WATER GUN", "HYDRO PUMP", "SURF", "ICE BEAM", "BLIZZARD", "PSYBEAM", "BUBBLEBEAM", "AURORA BEAM", "HYPER BEAM", "PECK", "DRILL PECK", "SUBMISSION", "LOW KICK", "COUNTER", "SEISMIC TOSS", "STRENGTH", "ABSORB", "MEGA DRAIN", "LEECH SEED", "GROWTH", "RAZOR LEAF", "SOLARBEAM", "POISONPOWDER", "STUN SPORE", "SLEEP POWDER", "PETAL DANCE", "STRING SHOT", "DRAGON RAGE", "FIRE SPIN", "THUNDERSHOCK", "THUNDERBOLT", "THUNDER WAVE", "THUNDER", "ROCK THROW", "EARTHQUAKE", "FISSURE", "DIG", "TOXIC", "CONFUSION", "PSYCHIC", "HYPNOSIS", "MEDITATE", "AGILITY", "QUICK ATTACK", "RAGE", "TELEPORT", "NIGHT SHADE", "MIMIC", "SCREECH", "DOUBLE TEAM", "RECOVER", "HARDEN", "MINIMIZE", "SMOKESCREEN", "CONFUSE RAY", "WITHDRAW", "DEFENSE CURL", "BARRIER", "LIGHT SCREEN", "HAZE", "REFLECT", "FOCUS ENERGY", "BIDE", "METRONOME", "MIRROR MOVE", "SELFDESTRUCT", "EGG BOMB", "LICK", "SMOG", "SLUDGE", "BONE CLUB", "FIRE BLAST", "WATERFALL", "CLAMP", "SWIFT", "SKULL BASH", "SPIKE CANNON", "CONSTRICT", "AMNESIA", "KINESIS", "SOFTBOILED", "HI JUMP KICK", "GLARE", "DREAM EATER", "POISON GAS", "BARRAGE", "LEECH LIFE", "LOVELY KISS", "SKY ATTACK", "TRANSFORM", "BUBBLE", "DIZZY PUNCH", "SPORE", "FLASH", "PSYWAVE", "SPLASH", "ACID ARMOR", "CRABHAMMER", "EXPLOSION", "FURY SWIPES", "BONEMERANG", "REST", "ROCK SLIDE", "HYPER FANG", "SHARPEN", "CONVERSION", "TRI ATTACK", "SUPER FANG", "SLASH", "SUBSTITUTE", "STRUGGLE", "SKETCH", "TRIPLE KICK", "THIEF", "SPIDER WEB", "MIND READER", "NIGHTMARE", "FLAME WHEEL", "SNORE", "CURSE", "FLAIL", "CONVERSION 2", "AEROBLAST", "COTTON SPORE", "REVERSAL", "SPITE", "POWDER SNOW", "PROTECT", "MACH PUNCH", "SCARY FACE", "FAINT ATTACK", "SWEET KISS", "BELLY DRUM", "SLUDGE BOMB", "MUD-SLAP", "OCTAZOOKA", "SPIKES", "ZAP CANNON", "FORESIGHT", "DESTINY BOND", "PERISH SONG", "ICY WIND", "DETECT", "BONE RUSH", "LOCK-ON", "OUTRAGE", "SANDSTORM", "GIGA DRAIN", "ENDURE", "CHARM", "ROLLOUT", "FALSE SWIPE", "SWAGGER", "MILK DRINK", "SPARK", "FURY CUTTER", "STEEL WING", "MEAN LOOK", "ATTRACT", "SLEEP TALK", "HEAL BELL", "RETURN", "PRESENT", "FRUSTRATION", "SAFEGUARD", "PAIN SPLIT", "SACRED FIRE", "MAGNITUDE", "DYNAMICPUNCH", "MEGAHORN", "DRAGONBREATH", "BATON PASS", "ENCORE", "PURSUIT", "RAPID SPIN", "SWEET SCENT", "IRON TAIL", "METAL CLAW", "VITAL THROW", "MORNING SUN", "SYNTHESIS", "MOONLIGHT", "HIDDEN POWER", "CROSS CHOP", "TWISTER", "RAIN DANCE", "SUNNY DAY", "CRUNCH", "MIRROR COAT", "PSYCH UP", "EXTREMESPEED", "ANCIENTPOWER", "SHADOW BALL", "FUTURE SIGHT", "ROCK SMASH", "WHIRLPOOL", "BEAT UP", "FAKE OUT", "UPROAR", "STOCKPILE", "SPIT UP", "SWALLOW", "HEAT WAVE", "HAIL", "TORMENT", "FLATTER", "WILL-O-WISP", "MEMENTO", "FACADE", "FOCUS PUNCH", "SMELLINGSALT", "FOLLOW ME", "NATURE POWER", "CHARGE", "TAUNT", "HELPING HAND", "TRICK", "ROLE PLAY", "WISH", "ASSIST", "INGRAIN", "SUPERPOWER", "MAGIC COAT", "RECYCLE", "REVENGE", "BRICK BREAK", "YAWN", "KNOCK OFF", "ENDEAVOR", "ERUPTION", "SKILL SWAP", "IMPRISON", "REFRESH", "GRUDGE", "SNATCH", "SECRET POWER", "DIVE", "ARM THRUST", "CAMOUFLAGE", "TAIL GLOW", "LUSTER PURGE", "MIST BALL", "FEATHERDANCE", "TEETER DANCE", "BLAZE KICK", "MUD SPORT", "ICE BALL", "NEEDLE ARM", "SLACK OFF", "HYPER VOICE", "POISON FANG", "CRUSH CLAW", "BLAST BURN", "HYDRO CANNON", "METEOR MASH", "ASTONISH", "WEATHER BALL", "AROMATHERAPY", "FAKE TEARS", "AIR CUTTER", "OVERHEAT", "ODOR SLEUTH", "ROCK TOMB", "SILVER WIND", "METAL SOUND", "GRASSWHISTLE", "TICKLE", "COSMIC POWER", "WATER SPOUT", "SIGNAL BEAM", "SHADOW PUNCH", "EXTRASENSORY", "SKY UPPERCUT", "SAND TOMB", "SHEER COLD", "MUDDY WATER", "BULLET SEED", "AERIAL ACE", "ICICLE SPEAR", "IRON DEFENSE", "BLOCK", "HOWL", "DRAGON CLAW", "FRENZY PLANT", "BULK UP", "BOUNCE", "MUD SHOT", "POISON TAIL", "COVET", "VOLT TACKLE", "MAGICAL LEAF", "WATER SPORT", "CALM MIND", "LEAF BLADE", "DRAGON DANCE", "ROCK BLAST", "SHOCK WAVE", "WATER PULSE", "DOOM DESIRE", "PSYCHO BOOST"];

// Typ-Nummern wie in include/constants/pokemon.h. Farben angelehnt an die Typ-Schilder des Spiels.
export const TYPES = {
  0:  { name: 'NORMAL',   color: '#a8a878' },
  1:  { name: 'KAMPF',    color: '#c03028' },
  2:  { name: 'FLUG',     color: '#a890f0' },
  3:  { name: 'GIFT',     color: '#a040a0' },
  4:  { name: 'BODEN',    color: '#e0c068' },
  5:  { name: 'GESTEIN',  color: '#b8a038' },
  6:  { name: 'KÄFER',    color: '#a8b820' },
  7:  { name: 'GEIST',    color: '#705898' },
  8:  { name: 'STAHL',    color: '#b8b8d0' },
  9:  { name: '???',      color: '#68a090' },
  10: { name: 'FEUER',    color: '#f08030' },
  11: { name: 'WASSER',   color: '#6890f0' },
  12: { name: 'PFLANZE',  color: '#78c850' },
  13: { name: 'ELEKTRO',  color: '#f8d030' },
  14: { name: 'PSYCHO',   color: '#f85888' },
  15: { name: 'EIS',      color: '#98d8d8' },
  16: { name: 'DRACHE',   color: '#7038f8' },
  17: { name: 'UNLICHT',  color: '#705848' },
};

// Spielzeichensatz (Gen 3) -> Text.
// Steuercodes: 0xFE Zeilenumbruch, 0xFA/0xFB Absatz, 0xFC xx ... Formatierung, 0xFD xx Platzhalter, 0xFF Ende.
const EXT_PARAMS = [0, 1, 1, 1, 3, 1, 1, 0, 1, 0, 0, 2, 1, 1, 1, 0, 2, 1, 1, 1, 1, 0, 0, 0, 0];
const PLACEHOLDER = { 1: '[Name]', 2: '[Text]', 3: '[Text]', 4: '[Text]', 6: 'Kun', 7: '[Rivale]', 8: 'Smaragd', 9: '[Team]', 10: '[Team]', 11: '[Boss]', 12: '[Boss]', 13: '[Legendäres]', 14: '[Legendäres]' };

/** @param {ArrayLike<number>} bytes @param {{lines?: 'keep'|'space'}} [opt] */
export function decodeGameString(bytes, opt) {
  const keep = opt && opt.lines === 'keep';
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0xff) break;
    if (b === 0xfe) { out += keep ? '\n' : ' '; continue; }
    if (b === 0xfa || b === 0xfb) { out += keep ? '\n\n' : ' '; continue; }
    if (b === 0xfc) {
      const code = bytes[i + 1];
      i += 1 + (EXT_PARAMS[code] !== undefined ? EXT_PARAMS[code] : 1);
      continue;
    }
    if (b === 0xfd) { out += PLACEHOLDER[bytes[i + 1]] || ''; i++; continue; }
    const ch = CHARMAP[b];
    out += ch != null ? ch : '';
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
