// Applies a saved theme before first paint so dark mode never flashes light.
try {
  var t = localStorage.getItem("konnect.theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
