import "dotenv/config";
import { auth } from "../auth.js";

async function createUser() {
  try {
    const res = await auth.api.signUpEmail({
      body: {
        name: "John Doe",
        email: "john.doe@example.com",
        password: "password1234",
      },
    });

    console.log("Utilisateur créé :", res);
  } catch (err) {
    console.error("Erreur :", err);
  } finally {
    process.exit(0);
  }
}

createUser();
