"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ClipboardCopy,
  Minus,
  Plus,
  Printer,
  ShoppingCart,
  Store,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/lib/store/store";
import { PROJECT_BY_ID } from "@/lib/seed/projects";
import {
  DEPARTMENT_LABELS,
  estimatedTotalCents,
  groupByDepartment,
  groupByProject,
  remainingItemCount,
  toPlainText,
} from "@/lib/shopping";
import { formatCents } from "@/lib/format";
import { customItemSchema, type CustomItemFormValues } from "@/lib/validation";
import type { ShoppingListItem, StoreDepartment } from "@/lib/types";

const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as StoreDepartment[];

function ItemRow({ item }: { item: ShoppingListItem }) {
  const { updateShoppingItem, removeShoppingItem } = useAppStore();
  return (
    <li className="flex items-center gap-3 py-2">
      <Checkbox
        checked={item.purchased}
        onCheckedChange={(v) => updateShoppingItem(item.id, { purchased: v === true })}
        aria-label={`Mark ${item.name} as purchased`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={
            item.purchased
              ? "truncate text-sm line-through text-muted-foreground"
              : "truncate text-sm font-medium"
          }
        >
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground">
          ~{formatCents(item.estimatedUnitCostCents * item.quantity)} est.
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={`Decrease quantity of ${item.name}`}
          onClick={() =>
            updateShoppingItem(item.id, { quantity: Math.max(1, item.quantity - 1) })
          }
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <span className="w-6 text-center text-sm tabular-nums" aria-label="Quantity">
          {item.quantity}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={`Increase quantity of ${item.name}`}
          onClick={() => updateShoppingItem(item.id, { quantity: item.quantity + 1 })}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          checked={item.owned}
          onCheckedChange={(v) => updateShoppingItem(item.id, { owned: v === true })}
          aria-label={`Mark ${item.name} as already owned`}
        />
        Own it
      </label>

      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={`Remove ${item.name}`}
        onClick={() => removeShoppingItem(item.id)}
      >
        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddCustomItem() {
  const { addCustomShoppingItem } = useAppStore();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CustomItemFormValues>({
    resolver: zodResolver(customItemSchema),
    defaultValues: { name: "", quantity: 1, department: "other", estimatedUnitCostCents: 0 },
  });
  const department = watch("department");

  const onSubmit = (values: CustomItemFormValues) => {
    addCustomShoppingItem({
      projectId: null,
      refId: null,
      name: values.name,
      department: values.department ?? "other",
      quantity: Number(values.quantity),
      estimatedUnitCostCents: Number(values.estimatedUnitCostCents ?? 0),
      owned: false,
      purchased: false,
    });
    reset({ name: "", quantity: 1, department: "other", estimatedUnitCostCents: 0 });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
    >
      <div>
        <Label htmlFor="custom-name" className="sr-only">
          Item name
        </Label>
        <Input id="custom-name" placeholder="Add a custom item…" {...register("name")} />
        {errors.name ? (
          <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
        ) : null}
      </div>
      <div className="w-24">
        <Label htmlFor="custom-qty" className="sr-only">
          Quantity
        </Label>
        <Input id="custom-qty" type="number" min={1} {...register("quantity")} />
      </div>
      <div className="w-40">
        <Label htmlFor="custom-dept" className="sr-only">
          Department
        </Label>
        <Select
          value={department}
          onValueChange={(v) => setValue("department", v as StoreDepartment)}
        >
          <SelectTrigger id="custom-dept">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit">
        <Plus className="h-4 w-4" aria-hidden="true" /> Add
      </Button>
    </form>
  );
}

export function ShoppingListClient() {
  const { hydrated, data, clearPurchasedShoppingItems } = useAppStore();
  const [copied, setCopied] = useState(false);

  if (!hydrated) {
    return (
      <div className="container max-w-3xl py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  const items = data.shoppingList?.items ?? [];
  const total = estimatedTotalCents(items);
  const remaining = remainingItemCount(items);
  const departmentGroups = groupByDepartment(items.filter((i) => !i.owned));
  const projectGroups = groupByProject(items.filter((i) => !i.owned));

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(items));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Shopping list</h1>
          <p className="text-muted-foreground">
            {remaining} item{remaining === 1 ? "" : "s"} left to buy · estimated total{" "}
            <span className="font-medium text-foreground">~{formatCents(total)}</span>
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Button variant="outline" size="sm" onClick={copyList} disabled={items.length === 0}>
            {copied ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copy
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={items.length === 0}
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-10 w-10" />}
          title="Your shopping list is empty"
          description="Open a project and add its missing tools and materials to build a shopping list."
          action={
            <Button asChild>
              <Link href="/projects">Browse projects</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            All prices are rough estimates to help you plan — not live store pricing.
          </p>

          <Tabs defaultValue="department">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="department">
                  <Store className="mr-1.5 h-4 w-4" aria-hidden="true" /> By department
                </TabsTrigger>
                <TabsTrigger value="project">By project</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="department">
              <div className="space-y-4">
                {departmentGroups.map((group) => (
                  <Card key={group.department}>
                    <CardContent className="p-4">
                      <h2 className="mb-1 flex items-center gap-2 font-semibold">
                        {group.label}
                        <Badge variant="muted">{group.items.length}</Badge>
                      </h2>
                      <ul className="divide-y">
                        {group.items.map((item) => (
                          <ItemRow key={item.id} item={item} />
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="project">
              <div className="space-y-4">
                {projectGroups.map((group) => {
                  const project = group.projectId ? PROJECT_BY_ID[group.projectId] : null;
                  return (
                    <Card key={group.projectId ?? "custom"}>
                      <CardContent className="p-4">
                        <h2 className="mb-1 flex items-center gap-2 font-semibold">
                          {project ? project.title : "Custom items"}
                          <Badge variant="muted">{group.items.length}</Badge>
                        </h2>
                        <ul className="divide-y">
                          {group.items.map((item) => (
                            <ItemRow key={item.id} item={item} />
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>

          {items.some((i) => i.purchased) ? (
            <div className="mt-4 no-print">
              <Button variant="ghost" size="sm" onClick={clearPurchasedShoppingItems}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear purchased items
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Card className="mt-6 no-print">
        <CardContent className="p-4">
          <h2 className="mb-3 font-semibold">Add a custom item</h2>
          <AddCustomItem />
        </CardContent>
      </Card>
    </div>
  );
}
