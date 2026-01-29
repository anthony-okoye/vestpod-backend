// =====================================================
// Shared Authentication Module
// =====================================================
// Provides JWT verification for protected Edge Functions
// Uses ANON_KEY for proper user token validation

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

// Client for JWT verification (uses anon key)
const authClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Verify JWT token and return authenticated user
 * @param token - JWT access token from Authorization header
 * @returns User object if token is valid
 * @throws Error if token is invalid or expired
 */
export async function verifyJWT(token: string) {
  console.log("=== JWT Verification Debug ===");
  console.log("Token length:", token?.length);
  console.log("Token prefix:", token?.substring(0, 20) + "...");
  console.log("Supabase URL:", supabaseUrl);
  console.log("Using ANON_KEY:", supabaseAnonKey ? "YES (length: " + supabaseAnonKey.length + ")" : "NO");
  
  try {
    const { data: { user }, error } = await authClient.auth.getUser(token);
    
    console.log("Auth response - Error:", error);
    console.log("Auth response - User:", user ? "Found (id: " + user.id + ")" : "NULL");
    
    if (error) {
      console.error("JWT verification error details:", JSON.stringify(error));
      throw new Error("Invalid or expired token");
    }
    
    if (!user) {
      console.error("No user found in JWT");
      throw new Error("Invalid or expired token");
    }
    
    console.log("JWT verification SUCCESS for user:", user.id);
    return user;
  } catch (error) {
    console.error("JWT verification exception:", error);
    throw new Error("Invalid or expired token");
  }
}

/**
 * Extract token from Authorization header
 * @param req - HTTP Request object
 * @returns JWT token string
 * @throws Error if Authorization header is missing or malformed
 */
export function extractToken(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  
  console.log("=== Token Extraction Debug ===");
  console.log("Authorization header present:", !!authHeader);
  console.log("Authorization header value:", authHeader?.substring(0, 30) + "...");
  
  if (!authHeader) {
    throw new Error("Authorization header required");
  }
  
  const token = authHeader.replace("Bearer ", "");
  
  console.log("Token after Bearer removal:", token?.substring(0, 30) + "...");
  console.log("Token equals original header:", token === authHeader);
  
  if (!token || token === authHeader) {
    throw new Error("Invalid Authorization header format");
  }
  
  return token;
}

/**
 * Authenticate request and return user
 * Combines token extraction and verification
 * @param req - HTTP Request object
 * @returns User object if authenticated
 * @throws Error if authentication fails
 */
export async function authenticateRequest(req: Request) {
  const token = extractToken(req);
  return await verifyJWT(token);
}
