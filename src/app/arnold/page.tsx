import { redirect } from "next/navigation";

/** Arnold's console moved into the agent template. */
export default function ArnoldRedirect() {
  redirect("/agents/arnold");
}
