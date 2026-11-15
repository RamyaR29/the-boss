export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "happy"
  | "confused"
  | "sleeping"
  | "celebrating"
  | "staring";

export const CHARACTER_STATES: CharacterState[] = [
  "idle",
  "listening",
  "thinking",
  "talking",
  "happy",
  "confused",
  "sleeping",
  "celebrating",
  "staring",
];

/**
 * Front legs ("hands"), one path per pose. Each starts at the shoulder; CSS
 * shows the pose that fits the mood. Left/right are as the viewer sees them.
 */
const ARMS = [
  ["arm-l arm-l-rest", "M53 125 Q54 138 62 145"],
  ["arm-l arm-l-up", "M52 124 Q40 110 37 95"],
  ["arm-l arm-l-out", "M52 124 Q40 132 32 125"],
  ["arm-l arm-l-cheek", "M52 124 Q44 116 55 109"],
  ["arm-r arm-r-rest", "M107 125 Q106 138 98 145"],
  ["arm-r arm-r-up", "M108 124 Q120 110 123 95"],
  ["arm-r arm-r-out", "M108 124 Q120 132 128 125"],
  ["arm-r arm-r-chin", "M108 124 Q112 115 101 113"],
] as const;

/** A four-point sparkle centred on (x, y). */
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`;

/**
 * The Boss: a small, clever lavender-gray elephant with round gold glasses and
 * a tiny coral backpack. Every mood is a CSS class on the root <svg>; the ears
 * and trunk carry most of the expression (see Elephant.css).
 */
export function Elephant({ state }: { state: CharacterState }) {
  return (
    <svg
      className={`elephant state-${state}`}
      viewBox="0 0 160 180"
      width="160"
      height="180"
      role="img"
      aria-label={`The Boss elephant, ${state}`}
    >
      <ellipse className="shadow" cx="80" cy="171" rx="40" ry="6" />

      {/* Overlays that appear in some moods */}
      <g className="think-dots">
        <circle cx="114" cy="30" r="4" />
        <circle cx="126" cy="19" r="5" />
        <circle cx="140" cy="8" r="6" />
      </g>
      <text className="q-mark" x="122" y="30">?</text>
      <g className="zzz">
        <text x="112" y="44">z</text>
        <text x="124" y="30">z</text>
        <text x="138" y="16">z</text>
      </g>
      <g className="waves" fill="none" strokeLinecap="round">
        <path d="M153 66 Q160 82 153 98" />
        <path d="M145 72 Q150 82 145 92" />
      </g>
      <g className="sparkles">
        <path d={sparkle(18, 34, 7)} />
        <path d={sparkle(144, 40, 6)} />
        <path d={sparkle(12, 118, 5)} />
        <path d={sparkle(150, 122, 7)} />
      </g>

      <g className="bob">
        {/* Tiny coral "everything bag", peeking out behind the body */}
        <g className="backpack">
          <rect className="pack" x="99" y="117" width="31" height="36" rx="12" />
          <rect className="pack-flap" x="99" y="117" width="31" height="14" rx="9" />
          <circle className="pack-clasp" cx="114.5" cy="131" r="2.6" />
        </g>

        {/* Body and feet */}
        <ellipse className="body" cx="80" cy="142" rx="33" ry="24" />
        <path className="strap" d="M106 123 Q88 138 66 158" fill="none" strokeLinecap="round" />
        <g className="feet">
          <rect className="foot" x="55" y="152" width="19" height="16" rx="8" />
          <rect className="foot" x="86" y="152" width="19" height="16" rx="8" />
          <circle className="toe" cx="60" cy="165" r="1.6" />
          <circle className="toe" cx="64.5" cy="166" r="1.6" />
          <circle className="toe" cx="69" cy="165" r="1.6" />
          <circle className="toe" cx="91" cy="165" r="1.6" />
          <circle className="toe" cx="95.5" cy="166" r="1.6" />
          <circle className="toe" cx="100" cy="165" r="1.6" />
        </g>

        {/* Big floppy ears: the main way it shows how it feels */}
        <g className="ear ear-left">
          <ellipse className="ear-outer" cx="32" cy="84" rx="32" ry="38" />
          <ellipse className="ear-inner" cx="35" cy="86" rx="20" ry="25" />
        </g>
        <g className="ear ear-right">
          <ellipse className="ear-outer" cx="128" cy="84" rx="32" ry="38" />
          <ellipse className="ear-inner" cx="125" cy="86" rx="20" ry="25" />
        </g>

        <g className="head-group">
          <circle className="head" cx="80" cy="80" r="47" />
          <ellipse className="cheek" cx="53" cy="101" rx="7" ry="4" />
          <ellipse className="cheek" cx="107" cy="101" rx="7" ry="4" />

          {/* Eyes: open, closed (sleeping) and happy arcs */}
          <g className="eyes-open">
            <g className="eye">
              <circle className="pupil" cx="65" cy="80" r="6.5" />
              <circle className="shine" cx="67.4" cy="77.6" r="2.2" />
            </g>
            <g className="eye">
              <circle className="pupil" cx="95" cy="80" r="6.5" />
              <circle className="shine" cx="97.4" cy="77.6" r="2.2" />
            </g>
            <rect className="lid" x="57" y="71" width="16" height="0" />
            <rect className="lid" x="87" y="71" width="16" height="0" />
          </g>
          <g className="eyes-closed" fill="none" strokeLinecap="round">
            <path d="M58 81 Q65 86 72 81" />
            <path d="M88 81 Q95 86 102 81" />
          </g>
          <g className="eyes-happy" fill="none" strokeLinecap="round">
            <path d="M58 83 Q65 75 72 83" />
            <path d="M88 83 Q95 75 102 83" />
          </g>

          {/* Round gold wire glasses, always on */}
          <g className="glasses" fill="none" strokeLinecap="round">
            <circle className="lens" cx="65" cy="80" r="12.5" />
            <circle className="lens" cx="95" cy="80" r="12.5" />
            <path d="M77.5 79 Q80 75.5 82.5 79" />
            <path d="M52.5 78 L43 74" />
            <path d="M107.5 78 L117 74" />
          </g>

          {/* Mouth: a small smile, or open while talking */}
          <path className="mouth-smile" d="M63 108 Q68 113 73 109" fill="none" strokeLinecap="round" />
          <ellipse className="mouth-open" cx="68" cy="110" rx="4.5" ry="2.2" />

          {/* Trunk: resting, or pointing at you. Each is drawn twice (outline,
              then fill) so it stands out from the face. */}
          {(
            [
              ["trunk-rest", "M80 95 C78 114 82 130 93 134"],
              ["trunk-point", "M80 95 C80 113 95 117 106 103"],
            ] as const
          ).map(([cls, d]) => (
            <g key={cls} className={`trunk ${cls}`} fill="none" strokeLinecap="round">
              <path className="trunk-edge" d={d} />
              <path className="trunk-fill" d={d} />
            </g>
          ))}
        </g>

        {/* Front legs ("hands"): drawn twice like the trunk so they read against the body */}
        {ARMS.map(([cls, d]) => (
          <g key={cls} className={`arm ${cls}`} fill="none" strokeLinecap="round">
            <path className="arm-edge" d={d} />
            <path className="arm-fill" d={d} />
          </g>
        ))}
      </g>
    </svg>
  );
}
