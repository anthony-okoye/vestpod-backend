// =====================================================
// Vestpod - OAuth Callback Handler Edge Function
// =====================================================
// Handles OAuth callbacks from Google and Apple
// Creates user profile after successful OAuth authentication
// Requirements: 1

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with modern secret key
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
// Use modern secret key (sb_secret_...) instead of legacy service_role JWT
const supabaseSecretKey = Deno.env.get("SUPABASE_SECRET_KEY")!;

const supabase = createClient(supabaseUrl, supabaseSecretKey);

/**
 * Create user profile after OAuth authentication
 */
async function createUserProfile(userId: string, email: string, fullName?: string, avatarUrl?: string) {
  try {
    // Check if profile already exists
    const { data: existingProfile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", userId)
      .single();

    if (existingProfile) {
      console.log("User profile already exists:", userId);
      return existingProfile;
    }

    // Create new profile
    const { data, error } = await supabase
      .from("user_profiles")
      .insert({
        id: userId,
        email: email,
        full_name: fullName || null,
        avatar_url: avatarUrl || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating user profile:", error);
      throw error;
    }

    console.log("User profile created successfully:", userId);
    return data;
  } catch (_error) {
    console.error("Failed to create user profile:", _error);
    throw _error;
  }
}

/**
 * Send JSON response
 */
function jsonResponse(data: Record<string, unknown> | { error: string } | { success: boolean; [key: string]: unknown }, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Send error response
 */
function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// =====================================================
// Main Request Handler
// =====================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    
    // Get auth code from query params
    const code = url.searchParams.get("code");
    
    if (!code) {
      return errorResponse("Authorization code not found", 400);
    }

    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("OAuth callback error:", error);
      return errorResponse(error.message, 400);
    }

    if (!data.user) {
      return errorResponse("User not found", 400);
    }

    // Extract user information from OAuth provider
    const user = data.user;
    const email = user.email!;
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name;
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;

    // Create user profile
    await createUserProfile(user.id, email, fullName, avatarUrl);

    // Redirect to mobile app with session
    const redirectUrl = `${Deno.env.get("SITE_URL")}/auth/callback?access_token=${data.session.access_token}&refresh_token=${data.session.refresh_token}`;

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
      },
    });
  } catch (_error) {
    console.error("OAuth callback handler error:", _error);
    return errorResponse("Internal server error", 500);
  }
});
