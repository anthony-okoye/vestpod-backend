// =====================================================
// Vestpod - Account Deletion Edge Function
// =====================================================
// Handles permanent account deletion with cascade cleanup
// - DELETE /account-deletion - Delete user account and all data
// Requirements: 12, 14

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with service role key for admin operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
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
  } catch (_error) {
    throw new Error("Invalid or expired token");
  }
}

/**
 * Send JSON response
 */
function jsonResponse(data: Record<string, unknown> | { error: string }, status = 200) {
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

/**
 * Delete all user files from storage buckets
 */
async function deleteUserStorageFiles(userId: string) {
  const buckets = ["avatars", "exports"];
  
  for (const bucket of buckets) {
    try {
      // List all files in user's folder
      const { data: files, error: listError } = await supabase.storage
        .from(bucket)
        .list(userId);

      if (listError) {
        console.error(`Error listing files in ${bucket}:`, listError);
        continue;
      }

      if (files && files.length > 0) {
        // Delete all files
        const filePaths = files.map((file) => `${userId}/${file.name}`);
        const { error: deleteError } = await supabase.storage
          .from(bucket)
          .remove(filePaths);

        if (deleteError) {
          console.error(`Error deleting files from ${bucket}:`, deleteError);
        } else {
          console.log(`Deleted ${files.length} files from ${bucket} for user ${userId}`);
        }
      }
    } catch (error) {
      console.error(`Exception while cleaning ${bucket}:`, error);
    }
  }
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * DELETE /account-deletion
 * Permanently delete user account and all associated data
 */
async function handleDeleteAccount(userId: string, req: Request) {
  try {
    const body = await req.json();
    const { confirmation } = body;

    // Require explicit confirmation
    if (confirmation !== "DELETE") {
      return errorResponse("Confirmation required. Please send { confirmation: 'DELETE' } to confirm account deletion");
    }

    console.log(`Starting account deletion for user: ${userId}`);

    // Step 1: Delete all storage files (avatars, exports)
    console.log("Step 1: Deleting storage files...");
    await deleteUserStorageFiles(userId);

    // Step 2: Delete user from auth.users
    // This will cascade delete all related data due to ON DELETE CASCADE:
    // - user_profiles (and triggers default portfolio/subscription deletion)
    // - portfolios
    // - assets
    // - price_history
    // - alerts
    // - subscriptions
    // - ai_insights
    // - ai_chat_history
    console.log("Step 2: Deleting user from auth.users (cascade delete)...");
    
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error("Error deleting user from auth:", deleteUserError);
      return errorResponse("Failed to delete account. Please try again or contact support.", 500);
    }

    console.log(`Account deletion completed successfully for user: ${userId}`);

    return jsonResponse({
      success: true,
      message: "Account deleted successfully. All your data has been permanently removed.",
    });
  } catch (error) {
    console.error("Delete account handler error:", error);
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
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Authorization header required", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    
    let user;
    try {
      user = await verifyJWT(token);
    } catch (_error) {
      return errorResponse("Invalid or expired token", 401);
    }

    // Only support DELETE method
    if (req.method !== "DELETE") {
      return errorResponse("Method not allowed. Use DELETE to delete account.", 405);
    }

    return await handleDeleteAccount(user.id, req);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
