"use client";
// Better-Auth browser client. baseURL defaults to same origin, which is correct
// since /api/auth/[...all] is served from this app.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
