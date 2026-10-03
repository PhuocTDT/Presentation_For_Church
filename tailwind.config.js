// Cấu hình Tailwind cho bản build tĩnh (thay cho Play CDN `cdn.tailwindcss.com`).
// Giữ tương đương khối `tailwind.config` từng nằm trong index.html.
// Build: npm run build:css  ->  src/css/tailwind.generated.css (được commit).
module.exports = {
  content: ['./index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#5048e5',
        'background-light': '#f6f6f8',
        'background-dark': '#121121'
      },
      fontFamily: {
        display: ['Inter']
      },
      borderRadius: { DEFAULT: '0.25rem', lg: '0.5rem', xl: '0.75rem', full: '9999px' }
    }
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')]
};
