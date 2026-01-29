// =====================================================
// Vestpod - Authentication Handler Edge Function
// =====================================================
// Handles user authentication operations:
// - Email/Password signup with OTP verification
// - Email/Password signin
// - Password reset
// - OAuth callbacks (Google, Apple)
// Requirements: 1

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with modern secret key
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
// Use modern secret key (sb_secret_...) instead of legacy service_role JWT
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);


// =====================================================
// Helper Functions
// =====================================================

/**
 * Verify JWT token and return user
 */
async function verifyJWT(token: string) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      throw new Error("Invalid or expired token");
    }
    
    return user;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}

/**
 * Create user profile after successful authentication
 */
async function createUserProfile(userId: string, email: string, firstName?: string, lastName?: string) {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .insert({
        id: userId,
        email: email,
        first_name: firstName || '',
        last_name: lastName || '',
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating user profile:", error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("Failed to create user profile:", error);
    throw error;
  }
}

/**
 * Send JSON response
 */
function jsonResponse(data: any, status = 200) {
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
// Route Handlers
// =====================================================

/**
 * POST /auth-handler/signup
 * Initiate email/password signup - sends OTP to email
 */
async function handleSignup(req: Request) {
  try {
    const { email, password, firstName, lastName } = await req.json();

    // Validate input
    if (!email || !password) {
      return errorResponse("Email and password are required");
    }

    if (!firstName || !lastName) {
      return errorResponse("First name and last name are required");
    }

    // Validate password strength
    if (password.length < 8) {
      return errorResponse("Password must be at least 8 characters");
    }

    // Check if password meets requirements (uppercase, lowercase, number)
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (!hasUppercase || !hasLowercase || !hasNumber) {
      return errorResponse(
        "Password must contain uppercase, lowercase, and number"
      );
    }

    // Create user with Supabase Auth (sends OTP email automatically)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    });

    if (error) {
      console.error("Signup error:", error);
      return errorResponse(error.message, 400);
    }

    // Check if user already exists
    if (data.user && !data.user.identities?.length) {
      return errorResponse("User already exists. Please sign in.", 409);
    }

    return jsonResponse({
      success: true,
      message: "Verification email sent. Please check your inbox.",
      userId: data.user?.id,
      email: data.user?.email,
    });
  } catch (error) {
    console.error("Signup handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/verify-otp
 * Verify OTP and complete signup
 */
async function handleVerifyOTP(req: Request) {
  try {
    const { email, token, type = "signup" } = await req.json();

    if (!email || !token) {
      return errorResponse("Email and token are required");
    }

    // Verify OTP with Supabase Auth
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: type as any,
    });

    if (error) {
      console.error("OTP verification error:", error);
      return errorResponse(error.message, 400);
    }

    if (!data.user) {
      return errorResponse("Verification failed", 400);
    }

    // Check if profile already exists
    const { data: existingProfile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", data.user.id)
      .single();

    // Create user profile if it doesn't exist
    if (!existingProfile) {
      await createUserProfile(
        data.user.id,
        data.user.email!,
        data.user.user_metadata?.first_name,
        data.user.user_metadata?.last_name
      );
    }

    return jsonResponse({
      success: true,
      message: "Email verified successfully",
      user: {
        id: data.user.id,
        email: data.user.email,
        emailConfirmed: data.user.email_confirmed_at !== null,
      },
      session: data.session,
    });
  } catch (error) {
    console.error("Verify OTP handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/resend-otp
 * Resend OTP email
 */
async function handleResendOTP(req: Request) {
  try {
    const { email, type = "signup" } = await req.json();

    if (!email) {
      return errorResponse("Email is required");
    }

    // Resend OTP
    const { error } = await supabase.auth.resend({
      type: type as any,
      email,
    });

    if (error) {
      console.error("Resend OTP error:", error);
      return errorResponse(error.message, 400);
    }

    return jsonResponse({
      success: true,
      message: "Verification email resent successfully",
    });
  } catch (error) {
    console.error("Resend OTP handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/signin
 * Email/password signin
 */
async function handleSignin(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return errorResponse("Email and password are required");
    }

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Signin error:", error);
      return errorResponse(error.message, 401);
    }

    if (!data.user) {
      return errorResponse("Authentication failed", 401);
    }

    // Check if email is confirmed
    if (!data.user.email_confirmed_at) {
      return errorResponse(
        "Email not verified. Please check your inbox for verification email.",
        403
      );
    }

    return jsonResponse({
      success: true,
      message: "Signed in successfully",
      user: {
        id: data.user.id,
        email: data.user.email,
        emailConfirmed: data.user.email_confirmed_at !== null,
      },
      session: data.session,
    });
  } catch (error) {
    console.error("Signin handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/reset-password
 * Send password reset email
 */
async function handleResetPassword(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return errorResponse("Email is required");
    }

    // Send password reset email
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${Deno.env.get("SITE_URL")}/auth/reset-password`,
    });

    if (error) {
      console.error("Reset password error:", error);
      return errorResponse(error.message, 400);
    }

    return jsonResponse({
      success: true,
      message: "Password reset email sent. Please check your inbox.",
    });
  } catch (error) {
    console.error("Reset password handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/update-password
 * Update password after reset
 */
async function handleUpdatePassword(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Authorization header required", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    
    // Verify JWT token
    try {
      await verifyJWT(token);
    } catch (error) {
      return errorResponse("Invalid or expired token", 401);
    }

    const { newPassword } = await req.json();

    if (!newPassword) {
      return errorResponse("New password is required");
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return errorResponse("Password must be at least 8 characters");
    }

    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);

    if (!hasUppercase || !hasLowercase || !hasNumber) {
      return errorResponse(
        "Password must contain uppercase, lowercase, and number"
      );
    }

    // Create authenticated client with user's token
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Update password
    const { data, error } = await userSupabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error("Update password error:", error);
      return errorResponse(error.message, 400);
    }

    return jsonResponse({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update password handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /auth-handler/signout
 * Sign out user
 */
async function handleSignout(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Authorization header required", 401);
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify JWT token
    try {
      await verifyJWT(token);
    } catch (error) {
      return errorResponse("Invalid or expired token", 401);
    }

    // Create authenticated client with user's token
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Sign out
    const { error } = await userSupabase.auth.signOut();

    if (error) {
      console.error("Signout error:", error);
      return errorResponse(error.message, 400);
    }

    return jsonResponse({
      success: true,
      message: "Signed out successfully",
    });
  } catch (error) {
    console.error("Signout handler error:", error);
    return errorResponse("Internal server error", 500);
  }
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
    const path = url.pathname;

    // Route requests
    if (path.endsWith("/signup") && req.method === "POST") {
      return await handleSignup(req);
    }

    if (path.endsWith("/verify-otp") && req.method === "POST") {
      return await handleVerifyOTP(req);
    }

    if (path.endsWith("/resend-otp") && req.method === "POST") {
      return await handleResendOTP(req);
    }

    if (path.endsWith("/signin") && req.method === "POST") {
      return await handleSignin(req);
    }

    if (path.endsWith("/reset-password") && req.method === "POST") {
      return await handleResetPassword(req);
    }

    if (path.endsWith("/update-password") && req.method === "POST") {
      return await handleUpdatePassword(req);
    }

    if (path.endsWith("/signout") && req.method === "POST") {
      return await handleSignout(req);
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
