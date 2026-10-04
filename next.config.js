/** @type {import('next').NextConfig} */
const corsHeaders = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
];

const nextConfig = {
  experimental: { typedRoutes: true },
  // timeline-studio (Vite, puerto 5173) lee el vídeo base, las escenas y la narración desde aquí.
  async headers() {
    return [
      { source: '/assets/:path*', headers: corsHeaders },
      { source: '/api/storyboards/:path*', headers: corsHeaders },
      { source: '/api/render-timeline', headers: corsHeaders },
      { source: '/api/render-timeline/:path*', headers: corsHeaders },
    ];
  },
};
module.exports = nextConfig;
