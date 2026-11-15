export type CharacterState = "idle" | "listening" | "thinking" | "talking";

export const CHARACTER_STATES: CharacterState[] = [
  "idle",
  "listening",
  "thinking",
  "talking",
];

/**
 * The Boss's original cartoon elephant. Each state is driven purely by a
 * CSS class on the root <svg>, so animations live in Elephant.css.
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
      {/* Ground shadow */}
      <ellipse className="shadow" cx="80" cy="170" rx="42" ry="6" />

      <g className="bob">
        {/* Thinking dots */}
        <g className="think-dots">
          <circle cx="112" cy="30" r="4" />
          <circle cx="124" cy="20" r="5" />
          <circle cx="138" cy="9" r="6" />
        </g>

        {/* Listening sound waves */}
        <g className="waves" fill="none" strokeLinecap="round">
          <path d="M150 64 Q157 78 150 92" />
          <path d="M142 70 Q147 78 142 86" />
        </g>

        {/* Body and feet */}
        <ellipse className="body" cx="80" cy="140" rx="38" ry="26" />
        <rect className="foot" x="52" y="150" width="18" height="16" rx="7" />
        <rect className="foot" x="90" y="150" width="18" height="16" rx="7" />

        {/* Ears */}
        <g className="ear ear-left">
          <ellipse className="ear-outer" cx="38" cy="80" rx="30" ry="36" />
          <ellipse className="ear-inner" cx="40" cy="82" rx="19" ry="24" />
        </g>
        <g className="ear ear-right">
          <ellipse className="ear-outer" cx="122" cy="80" rx="30" ry="36" />
          <ellipse className="ear-inner" cx="120" cy="82" rx="19" ry="24" />
        </g>

        {/* Head */}
        <circle className="head" cx="80" cy="82" r="44" />

        {/* Cheeks */}
        <ellipse className="cheek" cx="56" cy="98" rx="7" ry="4" />
        <ellipse className="cheek" cx="104" cy="98" rx="7" ry="4" />

        {/* Eyes */}
        <g className="eyes">
          <g className="eye">
            <circle className="pupil" cx="64" cy="76" r="5.5" />
            <circle className="shine" cx="66" cy="74" r="1.8" />
          </g>
          <g className="eye">
            <circle className="pupil" cx="96" cy="76" r="5.5" />
            <circle className="shine" cx="98" cy="74" r="1.8" />
          </g>
          <rect className="lid" x="56" y="68" width="16" height="0" />
          <rect className="lid" x="88" y="68" width="16" height="0" />
        </g>

        {/* Tusks */}
        <path className="tusk" d="M66 104 q-4 8 2 12" />
        <path className="tusk" d="M94 104 q4 8 -2 12" />

        {/* Mouth (sits beside the trunk) */}
        <ellipse className="mouth" cx="66" cy="114" rx="5" ry="2" />

        {/* Trunk */}
        <path
          className="trunk"
          d="M80 92 C78 118, 84 134, 98 132 C106 131, 108 124, 103 121"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
