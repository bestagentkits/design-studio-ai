export const presentationStyles = `.slide-player { color-scheme: dark; --presentation-ink: #fafafa; }
.slide-player > nav { background: #202126; color: #fafafa; border-bottom: 1px solid #3d3e46; font-size: 13px; }
.slide-player > nav button, .slide-player > nav select, .slide-player > nav input { color: #fafafa; background: #303139; border: 1px solid #53545e; border-radius: 7px; min-height: 38px; padding: 7px 10px; font: inherit; }
.slide-player > nav button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; cursor: pointer; }
.slide-player > nav button:hover { background: #454652; }
.slide-player > nav button:disabled { opacity: .4; cursor: default; }
.slide-player > nav label { display: inline-flex; align-items: center; gap: 6px; }
.slide-player > nav input[type=checkbox] { min-height: auto; }
.slide-player > nav :focus-visible { outline: 2px solid #bbacff; outline-offset: 3px; }
@media(max-width:760px) { .slide-player > nav { gap: 6px !important; padding: 8px !important; } .slide-player > nav button, .slide-player > nav select { min-height: 44px; } }
`;
