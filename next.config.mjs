import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable compression
  compress: true,
  
  // Allow build to complete despite linting errors for now
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  
  // Enable static optimization
  swcMinify: true,
  
  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400, // 24 hours
    dangerouslyAllowSVG: true,
    // Remove restrictive CSP for images in development
    ...(process.env.NODE_ENV === 'production' && {
      contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"
    }),
  },
  
  // Security headers for E2EE protection
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    
    // Development CSP - more permissive for Next.js dev features
    const devCSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' data:", // Allow data: URLs for scripts in dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' wss: ws: https:",
      "worker-src 'self' blob:",
      "child-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ');

    // Production CSP - functional for Next.js with security
    const prodCSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", // Need unsafe-inline for Next.js runtime
      "style-src 'self' 'unsafe-inline'", // Tailwind CSS
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' wss: ws: https:",
      "worker-src 'self' blob:",
      "child-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests"
    ].join('; ');
    
    return [
      {
        source: '/(.*)',
        headers: [
          // Enhanced Content Security Policy for E2EE
          {
            key: 'Content-Security-Policy',
            value: isDev ? devCSP : prodCSP
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Strict Transport Security
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
          // Permissions policy for E2EE security - allow camera/microphone for call features
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), payment=()'
          },
          // Enable SharedArrayBuffer for libsignal WASM in supporting browsers
          // Use credentialless in dev to avoid CORS issues with hot reload
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: isDev ? 'credentialless' : 'require-corp'
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin'
          }
        ],
      },
      {
        source: '/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/socket.io/(.*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ]
  },
  
  // Webpack optimization with E2EE support
  webpack: (config, { dev, isServer, webpack }) => {
    // Production optimizations
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        sideEffects: false,
      }
    }
    
    // E2EE crypto polyfills for client-side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        buffer: 'buffer',
        fs: false,
        path: 'path-browserify',
        os: 'os-browserify/browser',
        util: 'util',
        assert: 'assert',
        // Disable Node.js specific modules for browser
        'node-gyp-build': false,
        '@mapbox/node-pre-gyp': false,
        // Enable proper WASM support for libsignal-client
        vm: false,
        module: false
      };
      
      // Add ProvidePlugin for Buffer and process
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
          global: 'global/window',
        })
      );

      // Enable WASM support
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
        syncWebAssembly: true,
        topLevelAwait: true,
      };

      // WASM loader configuration
      config.module.rules.push({
        test: /\.wasm$/,
        type: 'webassembly/async',
      });
    }
    
    // Handle node: scheme imports with custom resolver
    const originalResolve = config.resolve;
    config.resolve = {
      ...originalResolve,
      alias: {
        ...originalResolve.alias,
        'node:buffer': 'buffer',
        'node:crypto': 'crypto-browserify',
        'node:stream': 'stream-browserify',
        'node:util': 'util',
        'node:assert': 'assert'
      }
    };

    // Add custom plugin to handle node: scheme and vfile minproc issue
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:/,
        (resource) => {
          const module = resource.request.replace(/^node:/, '');
          switch (module) {
            case 'buffer':
              resource.request = 'buffer';
              break;
            case 'crypto':
              resource.request = 'crypto-browserify';
              break;
            case 'stream':
              resource.request = 'stream-browserify';
              break;
            case 'util':
              resource.request = 'util';
              break;
            case 'assert':
              resource.request = 'assert';
              break;
            case 'path':
              resource.request = 'path-browserify';
              break;
            case 'os':
              resource.request = 'os-browserify/browser';
              break;
            default:
              throw new Error(`Unknown node: module: ${module}`);
          }
        }
      )
    );

    // Fix vfile import issues for react-markdown and node-gyp-build
    config.resolve.alias = {
      ...config.resolve.alias,
      '#minproc': false, // Disable the problematic minproc import
      '#minurl': false,   // Disable the problematic minurl import
      'node-gyp-build': false, // Disable node-gyp-build in browser
    };

    // Define comprehensive process globals for VFile compatibility  
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.cwd': 'function() { return "/"; }',
        'global.process.cwd': 'function() { return "/"; }',
        'global': 'globalThis',
        'process.version': '"v18.0.0"',
        'process.versions': '{ node: "18.0.0" }'
      })
    );

    // Improve libsignal-client loading with better WASM support
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    // Handle libsignal-client's native dependencies more gracefully
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^(node-gyp-build|@mapbox\/node-pre-gyp)$/,
        contextRegExp: /@signalapp/,
      })
    );

    // Don't try to externalize libsignal-client - let it bundle normally
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      // Remove any existing externalization of libsignal-client
      config.externals = config.externals.filter((external) => {
        if (typeof external === 'string') {
          return !external.includes('@signalapp/libsignal-client');
        }
        return true;
      });
    }

    
    return config
  },
  
  // Enable experimental features for performance and E2EE
  experimental: {
    optimizeCss: true,
    scrollRestoration: true,
    serverComponentsExternalPackages: ['@signalapp/libsignal-client'],
    esmExternals: 'loose'
  },
  
  // Output optimization - only use standalone for production builds
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  
  // Enable gzip compression
  async rewrites() {
    return []
  },
};

export default nextConfig;
