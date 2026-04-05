const themeScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("jtbc-portal-theme");
    const validThemes = new Set(["light", "dark", "pink", "green"]);
    const nextTheme = validThemes.has(storedTheme) ? storedTheme : "dark";
    document.documentElement.dataset.theme = nextTheme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
