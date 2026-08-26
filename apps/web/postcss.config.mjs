// Tailwind v4 is CSS-first: there is no tailwind.config.js. The theme lives in
// the @theme block in src/app/globals.css, and this plugin is the whole build
// integration.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
