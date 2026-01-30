// =====================================================
// Vestpod - Profile Handler Edge Function
// =====================================================
// Handles user profile management operations:
// - GET /profile - Retrieve user profile
// - PUT /profile - Update profile (name, phone, currency, language, preferences)
// - POST /profile/avatar - Upload avatar image
// - DELETE /profile/avatar - Delete avatar image
// Requirements: 12

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client
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

// =====================================================
// Route Handlers
// =====================================================

/**
 * GET /profile-handler
 * Retrieve user profile
 */
async function handleGetProfile(userId: string) {
  try {
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching profile:", error);
      return errorResponse("Failed to fetch profile", 500);
    }

    if (!profile) {
      return errorResponse("Profile not found", 404);
    }

    return jsonResponse({
      success: true,
      profile: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        avatarUrl: profile.avatar_url,
        phone: profile.phone,
        currencyPreference: profile.currency_preference,
        languagePreference: profile.language_preference,
        notificationsEnabled: profile.notifications_enabled,
        darkModeEnabled: profile.dark_mode_enabled,
        defaultChartView: profile.default_chart_view,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    });
  } catch (error) {
    console.error("Get profile handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * PUT /profile-handler
 * Update user profile
 */
async function handleUpdateProfile(userId: string, req: Request) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      phone,
      currencyPreference,
      languagePreference,
      notificationsEnabled,
      darkModeEnabled,
      defaultChartView,
    } = body;

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};

    if (firstName !== undefined) {
      if (typeof firstName !== "string" || firstName.trim().length === 0) {
        return errorResponse("First name must be a non-empty string");
      }
      updates.first_name = firstName.trim();
    }

    if (lastName !== undefined) {
      if (typeof lastName !== "string" || lastName.trim().length === 0) {
        return errorResponse("Last name must be a non-empty string");
      }
      updates.last_name = lastName.trim();
    }

    if (phone !== undefined) {
      if (phone !== null && typeof phone !== "string") {
        return errorResponse("Phone must be a string or null");
      }
      updates.phone = phone;
    }

    if (currencyPreference !== undefined) {
      if (typeof currencyPreference !== "string") {
        return errorResponse("Currency preference must be a string");
      }
      // Validate currency code (basic validation)
      if (!/^[A-Z]{3}$/.test(currencyPreference)) {
        return errorResponse("Currency preference must be a 3-letter code (e.g., USD, EUR)");
      }
      updates.currency_preference = currencyPreference;
    }

    if (languagePreference !== undefined) {
      if (typeof languagePreference !== "string") {
        return errorResponse("Language preference must be a string");
      }
      // Validate language code (basic validation)
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(languagePreference)) {
        return errorResponse("Language preference must be a valid code (e.g., en, en-US)");
      }
      updates.language_preference = languagePreference;
    }

    if (notificationsEnabled !== undefined) {
      if (typeof notificationsEnabled !== "boolean") {
        return errorResponse("Notifications enabled must be a boolean");
      }
      updates.notifications_enabled = notificationsEnabled;
    }

    if (darkModeEnabled !== undefined) {
      if (typeof darkModeEnabled !== "boolean") {
        return errorResponse("Dark mode enabled must be a boolean");
      }
      updates.dark_mode_enabled = darkModeEnabled;
    }

    if (defaultChartView !== undefined) {
      if (typeof defaultChartView !== "string") {
        return errorResponse("Default chart view must be a string");
      }
      // Validate chart view options
      const validViews = ["1D", "1W", "1M", "3M", "1Y", "ALL"];
      if (!validViews.includes(defaultChartView)) {
        return errorResponse(`Default chart view must be one of: ${validViews.join(", ")}`);
      }
      updates.default_chart_view = defaultChartView;
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return errorResponse("No valid fields to update");
    }

    // Update profile
    const { data: updatedProfile, error } = await supabase
      .from("user_profiles")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return errorResponse("Failed to update profile", 500);
    }

    return jsonResponse({
      success: true,
      message: "Profile updated successfully",
      profile: {
        id: updatedProfile.id,
        email: updatedProfile.email,
        firstName: updatedProfile.first_name,
        lastName: updatedProfile.last_name,
        avatarUrl: updatedProfile.avatar_url,
        phone: updatedProfile.phone,
        currencyPreference: updatedProfile.currency_preference,
        languagePreference: updatedProfile.language_preference,
        notificationsEnabled: updatedProfile.notifications_enabled,
        darkModeEnabled: updatedProfile.dark_mode_enabled,
        defaultChartView: updatedProfile.default_chart_view,
        updatedAt: updatedProfile.updated_at,
      },
    });
  } catch (error) {
    console.error("Update profile handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /profile-handler/avatar
 * Upload avatar image
 */
async function handleUploadAvatar(userId: string, req: Request) {
  try {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("avatar");

    if (!file || !(file instanceof File)) {
      return errorResponse("Avatar file is required");
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return errorResponse("Avatar must be a JPEG, PNG, or WebP image");
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return errorResponse("Avatar file size must be less than 5MB");
    }

    // Generate unique filename
    const fileExt = file.name.split(".").pop();
    const fileName = `${userId}/avatar.${fileExt}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(arrayBuffer);

    // Delete old avatar if exists
    const { data: existingFiles } = await supabase.storage
      .from("avatars")
      .list(userId);

    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map((f) => `${userId}/${f.name}`);
      await supabase.storage.from("avatars").remove(filesToDelete);
    }

    // Upload new avatar
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, fileData, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Error uploading avatar:", uploadError);
      return errorResponse("Failed to upload avatar", 500);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    const avatarUrl = urlData.publicUrl;

    // Update user profile with avatar URL
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating profile with avatar URL:", updateError);
      return errorResponse("Failed to update profile with avatar URL", 500);
    }

    return jsonResponse({
      success: true,
      message: "Avatar uploaded successfully",
      avatarUrl,
    });
  } catch (error) {
    console.error("Upload avatar handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * DELETE /profile-handler/avatar
 * Delete avatar image
 */
async function handleDeleteAvatar(userId: string) {
  try {
    // Get current avatar URL
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single();

    if (!profile?.avatar_url) {
      return errorResponse("No avatar to delete", 404);
    }

    // Delete avatar from storage
    const { data: existingFiles } = await supabase.storage
      .from("avatars")
      .list(userId);

    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map((f) => `${userId}/${f.name}`);
      const { error: deleteError } = await supabase.storage
        .from("avatars")
        .remove(filesToDelete);

      if (deleteError) {
        console.error("Error deleting avatar from storage:", deleteError);
        return errorResponse("Failed to delete avatar", 500);
      }
    }

    // Update user profile to remove avatar URL
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ avatar_url: null })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating profile to remove avatar URL:", updateError);
      return errorResponse("Failed to update profile", 500);
    }

    return jsonResponse({
      success: true,
      message: "Avatar deleted successfully",
    });
  } catch (error) {
    console.error("Delete avatar handler error:", error);
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

    const url = new URL(req.url);
    const path = url.pathname;

    // Route requests
    if (path.endsWith("/profile-handler") && req.method === "GET") {
      return await handleGetProfile(user.id);
    }

    if (path.endsWith("/profile-handler") && req.method === "PUT") {
      return await handleUpdateProfile(user.id, req);
    }

    if (path.endsWith("/profile-handler/avatar") && req.method === "POST") {
      return await handleUploadAvatar(user.id, req);
    }

    if (path.endsWith("/profile-handler/avatar") && req.method === "DELETE") {
      return await handleDeleteAvatar(user.id);
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
