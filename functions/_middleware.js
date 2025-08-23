// Cloudflare Pages Middleware for JWT Authentication System
export async function onRequest(context) {
  const { request, env, next } = context;
  
  // Proceed to the next middleware or route handler
  const response = await next();
  
  // Return the original response for all content
  // JWT authentication is now handled by the backend API
  return response;
}