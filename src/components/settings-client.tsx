"use client";

import { useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/lib/store/store";
import type { TextSize, ThemePreference, UnitSystem } from "@/lib/settings";

function OptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex flex-wrap gap-2 rounded-lg border bg-muted p-1"
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              name={name}
              onClick={() => onChange(opt.value)}
              className={
                active
                  ? "rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SettingsClient() {
  const { hydrated, data, updateSettings, resetAllData } = useAppStore();
  const [resetDone, setResetDone] = useState(false);

  if (!hydrated) {
    return (
      <div className="container max-w-2xl py-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    );
  }

  const s = data.settings;

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="text-muted-foreground">
        Personalize ProjectPath and manage your data.
      </p>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <OptionGroup<ThemePreference>
              name="theme"
              label="Theme"
              value={s.theme}
              onChange={(v) => updateSettings({ theme: v })}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
            <OptionGroup<TextSize>
              name="textSize"
              label="Text size"
              value={s.textSize}
              onChange={(v) => updateSettings({ textSize: v })}
              options={[
                { value: "small", label: "Small" },
                { value: "default", label: "Default" },
                { value: "large", label: "Large" },
              ]}
            />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="reduced-motion">Reduce motion</Label>
                <p className="text-sm text-muted-foreground">
                  Minimize animations and transitions.
                </p>
              </div>
              <Switch
                id="reduced-motion"
                checked={s.reducedMotion}
                onCheckedChange={(v) => updateSettings({ reducedMotion: v })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Units</CardTitle>
          </CardHeader>
          <CardContent>
            <OptionGroup<UnitSystem>
              name="units"
              label="Measurement units"
              value={s.units}
              onChange={(v) => updateSettings({ units: v })}
              options={[
                { value: "us", label: "U.S. customary (in, ft)" },
                { value: "metric", label: "Metric (cm, m)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notify-progress">Progress reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Nudges to resume a project you paused.
                </p>
              </div>
              <Switch
                id="notify-progress"
                checked={s.notifyProgress}
                onCheckedChange={(v) => updateSettings({ notifyProgress: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notify-safety">Safety tips</Label>
                <p className="text-sm text-muted-foreground">
                  Occasional safety reminders while you work.
                </p>
              </div>
              <Switch
                id="notify-safety"
                checked={s.notifySafety}
                onCheckedChange={(v) => updateSettings({ notifySafety: v })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" /> Reset data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              This permanently clears your progress, saved projects, notes,
              shopping list, and preferences on this device. This can&apos;t be
              undone.
            </p>
            {resetDone ? (
              <p role="status" className="text-sm text-success">
                Your data has been reset.
              </p>
            ) : (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset all data
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reset all data?</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This clears everything saved on this device and can&apos;t be
                    undone.
                  </p>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          resetAllData();
                          setResetDone(true);
                        }}
                      >
                        Yes, reset everything
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
