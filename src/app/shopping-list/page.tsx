import type { Metadata } from "next";
import { ShoppingListClient } from "@/components/shopping-list-client";

export const metadata: Metadata = {
  title: "Shopping list",
  description: "Your combined DIY shopping list with estimated prices.",
};

export default function ShoppingListPage() {
  return <ShoppingListClient />;
}
