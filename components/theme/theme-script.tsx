const themeScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("jtbc-portal-theme");
    const nextTheme = storedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
