import type { MuscleId, trainingWeek } from "../../../../packages/analytics/src/training-insights.js";
type Muscle = ReturnType<typeof trainingWeek>["muscles"][number];
const front: Partial<Record<MuscleId, string[]>> = {
  shoulders: ["M66 70 Q49 72 44 90 L42 108 Q51 108 60 96 L66 84Z", "M134 70 Q151 72 156 90 L158 108 Q149 108 140 96 L134 84Z"],
  chest: ["M68 76 Q80 71 98 80 L98 111 Q80 120 62 104 L62 91Z", "M132 76 Q120 71 102 80 L102 111 Q120 120 138 104 L138 91Z"],
  biceps: ["M43 111 Q52 109 59 101 L57 127 Q52 140 41 147 L35 141Z", "M157 111 Q148 109 141 101 L143 127 Q148 140 159 147 L165 141Z"],
  forearms: ["M34 146 L42 151 L37 173 L25 202 L18 198 L24 168Z", "M166 146 L158 151 L163 173 L175 202 L182 198 L176 168Z"],
  abs: ["M86 119 L98 120 L98 137 L84 136Z", "M102 120 L114 119 L116 136 L102 137Z", "M84 140 L98 141 L98 157 L85 156Z", "M102 141 L116 140 L115 156 L102 157Z", "M85 160 L98 161 L98 184 L90 180Z", "M102 161 L115 160 L110 180 L102 184Z"],
  obliques: ["M65 112 L79 119 L80 151 L86 181 L75 173 L68 141Z", "M135 112 L121 119 L120 151 L114 181 L125 173 L132 141Z"],
  quads: ["M75 190 Q88 195 96 205 L93 260 L86 286 Q78 281 73 265 L65 221Z", "M125 190 Q112 195 104 205 L107 260 L114 286 Q122 281 127 265 L135 221Z", "M68 228 L72 269 L78 285 L67 279 L61 249Z", "M132 228 L128 269 L122 285 L133 279 L139 249Z"],
  calves: ["M68 301 L82 301 L81 326 L74 370 L67 368 L63 329Z", "M132 301 L118 301 L119 326 L126 370 L133 368 L137 329Z"]
};
const back: Partial<Record<MuscleId, string[]>> = {
  "upper-back": ["M84 64 L97 63 L98 115 L73 91 L64 78Z", "M116 64 L103 63 L102 115 L127 91 L136 78Z"],
  shoulders: ["M62 76 Q48 77 43 96 L42 107 L58 100 L69 86Z", "M138 76 Q152 77 157 96 L158 107 L142 100 L131 86Z"],
  triceps: ["M43 111 L58 104 L59 125 Q54 143 43 149 L35 142Z", "M157 111 L142 104 L141 125 Q146 143 157 149 L165 142Z"],
  forearms: front.forearms!,
  lats: ["M63 102 L72 96 L96 121 L94 155 L80 166 L69 143Z", "M137 102 L128 96 L104 121 L106 155 L120 166 L131 143Z"],
  "lower-back": ["M96 142 L98 178 L79 190 L77 174Z", "M104 142 L102 178 L121 190 L123 174Z"],
  glutes: ["M77 190 Q89 183 98 187 L98 218 Q81 235 67 217 L68 204Z", "M123 190 Q111 183 102 187 L102 218 Q119 235 133 217 L132 204Z"],
  hamstrings: ["M66 225 Q81 239 96 225 L91 270 L82 288 L73 279Z", "M134 225 Q119 239 104 225 L109 270 L118 288 L127 279Z"],
  calves: ["M72 297 Q82 293 86 307 L83 335 L74 351 L65 333 L64 315Z", "M128 297 Q118 293 114 307 L117 335 L126 351 L135 333 L136 315Z"]
};
const silhouette = "M88 53 L88 64 Q78 68 65 70 Q47 70 41 88 L33 117 L28 143 L20 167 L12 202 L9 214 L15 222 L23 215 L29 200 L43 175 L50 154 L61 133 L66 157 L68 177 L61 212 L59 248 L65 284 L61 311 L64 345 L66 378 L60 394 Q66 401 80 395 L83 382 L84 352 L92 318 L93 290 L100 248 L107 290 L108 318 L116 352 L117 382 L120 395 Q134 401 140 394 L134 378 L136 345 L139 311 L135 284 L141 248 L139 212 L132 177 L134 157 L139 133 L150 154 L157 175 L171 200 L177 215 L185 222 L191 214 L188 202 L180 167 L172 143 L167 117 L159 88 Q153 70 135 70 Q122 68 112 64 L112 53Z";
export function MuscleMap({ muscles, selected, onSelect, secondary }: { muscles: Muscle[]; selected: MuscleId; onSelect: (id: MuscleId) => void; secondary: boolean }) {
  const max = Math.max(1, ...muscles.map(row => row.sets));
  return <div className="muscle-bodies">{([ ["Front", front], ["Back", back] ] as const).map(([side, paths]) => <figure key={side}>
    <svg viewBox="0 0 200 420" aria-label={`${side} muscle map`} role="group">
      <ellipse cx="100" cy="405" rx="47" ry="5" fill="#223126" opacity=".06"/>
      <path d={silhouette} fill="#e6e9e2" stroke="#d4dacd" strokeWidth="1.3"/>
      <path d="M82 24 Q82 7 100 7 Q118 7 118 24 L116 41 Q111 57 100 58 Q89 57 84 41Z" fill="#e6e9e2" stroke="#d4dacd" strokeWidth="1.3"/>
      <path d="M89 61 L100 70 L111 61 M100 194 L100 237" fill="none" stroke="#cbd2c4" strokeWidth="1.2"/>
      {Object.entries(paths).map(([key, regions]) => {
        const muscle = muscles.find(row => row.id === key)!;
        const color = muscle.sets ? (muscle.sets / max > .65 ? "#c73c42" : muscle.sets / max > .3 ? "#e56a6b" : "#f0a29c") : secondary && muscle.secondary ? "#efc8bc" : "#d1d8ca";
        return <g key={key} role="button" tabIndex={0} aria-label={`${side} ${muscle.name}: ${muscle.sets} primary sets, ${muscle.secondary} supporting sets`} aria-pressed={selected === key}
          className="muscle-region" onClick={() => onSelect(muscle.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(muscle.id); } }}>
          <title>{muscle.name} · {muscle.sets} primary sets · {muscle.secondary} supporting sets</title>
          {regions.map((d, index) => <path key={index} d={d} fill={color} stroke={selected === key ? "#293e25" : "#f7f8f4"} strokeWidth={selected === key ? 2 : 1.3} strokeLinejoin="round"/>)}
        </g>;
      })}
    </svg><figcaption>{side.toUpperCase()}</figcaption></figure>)}</div>;
}
