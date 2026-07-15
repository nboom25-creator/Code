"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SUGGESTIONS = [
  "paint a wall",
  "floating shelf",
  "running toilet",
  "patch drywall",
  "recaulk tub",
];

export function HeroSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const go = (q: string) => {
    const trimmed = q.trim();
    router.push(trimmed ? `/projects?q=${encodeURIComponent(trimmed)}` : "/projects");
  };

  return (
    <div className="w-full max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        role="search"
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <label htmlFor="hero-search" className="sr-only">
            Search DIY projects
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="hero-search"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="What do you want to fix or build?"
            className="h-12 pl-10 text-base"
          />
        </div>
        <Button type="submit" size="lg">
          Search
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Try:</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => go(s)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Badge variant="outline" className="cursor-pointer hover:bg-accent">
              {s}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
