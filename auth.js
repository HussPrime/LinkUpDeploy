import dotenv from "dotenv";
dotenv.config();

import { betterAuth } from "better-auth";
import { createPool } from "mysql2/promise";

const authDbPool = createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE,
});

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: authDbPool,

  allowNonBrowserRequests: true,

  emailAndPassword: {
    enabled: true,          // permet le login
    allowSignup: false,     // empêche la création de compte
  },

  socialProviders: {
    gitlab: {
      clientId: process.env.GITLAB_CLIENT_ID,
      clientSecret: process.env.GITLAB_CLIENT_SECRET,
      issuer: process.env.GITLAB_ISSUER || "https://git.s2.rpn.ch",
    },
  },

  //  Autoriser le front (selon versions BetterAuth)
  allowedOrigins: [
    process.env.CLIENT_ORIGIN
  ],

  trustedOrigins: [
    process.env.CLIENT_ORIGIN
  ],
});
