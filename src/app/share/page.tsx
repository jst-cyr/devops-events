"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export default function SharePage() {
  const [slackPost, setSlackPost] = useState<string>("");
  const [sponsorshipPost, setSponsorshipPost] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sponsorshipLoading, setSponsorshipLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sponsorshipCopied, setSponsorshipCopied] = useState(false);

  const handleGenerateSlackPost = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const response = await fetch("/api/slack-announcement", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to generate Slack announcement.");
      }

      const payload = (await response.json()) as { message: string };
      setSlackPost(payload.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to generate Slack announcement.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopySlackPost = async () => {
    if (!slackPost) {
      return;
    }

    try {
      await navigator.clipboard.writeText(slackPost);
      setCopied(true);
      setError(null);
    } catch {
      setError("Could not copy to clipboard. Please copy manually from the text box.");
    }
  };

  const handleGenerateSponsorshipPost = async () => {
    setSponsorshipLoading(true);
    setError(null);
    setSponsorshipCopied(false);

    try {
      const response = await fetch("/api/sponsorship-opportunities", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to generate sponsorship opportunities.");
      }

      const payload = (await response.json()) as { message: string };
      setSponsorshipPost(payload.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to generate sponsorship opportunities.");
    } finally {
      setSponsorshipLoading(false);
    }
  };

  const handleCopySponsorshipPost = async () => {
    if (!sponsorshipPost) {
      return;
    }

    try {
      await navigator.clipboard.writeText(sponsorshipPost);
      setSponsorshipCopied(true);
      setError(null);
    } catch {
      setError("Could not copy to clipboard. Please copy manually from the text box.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Share</h1>
      <p className="text-muted-foreground mt-2 text-sm sm:text-base">
        Generate a Slack announcement from current upcoming CFPs and events.
      </p>

      <div className="mt-6">
        <Button onClick={handleGenerateSlackPost} disabled={loading} className="w-full sm:w-auto">
          {loading ? "Generating..." : "Generate Slack Post"}
        </Button>
      </div>

      {slackPost ? (
        <div className="mt-6 space-y-3">
          <textarea
            className="bg-background min-h-56 w-full rounded-md border p-3 text-sm"
            readOnly
            value={slackPost}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleCopySlackPost}>Copy text</Button>
            {copied ? <p className="text-sm text-muted-foreground">Copied.</p> : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <hr className="my-8 border-border" />

      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Sponsorship Opportunities</h2>
      <p className="text-muted-foreground mt-2 text-sm sm:text-base">
        Generate a list of premium events at least 2 months out for the marketing team to evaluate sponsorship.
      </p>

      <div className="mt-6">
        <Button onClick={handleGenerateSponsorshipPost} disabled={sponsorshipLoading} className="w-full sm:w-auto">
          {sponsorshipLoading ? "Generating..." : "Generate Sponsorship List"}
        </Button>
      </div>

      {sponsorshipPost ? (
        <div className="mt-6 space-y-3">
          <textarea
            className="bg-background min-h-56 w-full rounded-md border p-3 text-sm"
            readOnly
            value={sponsorshipPost}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleCopySponsorshipPost}>Copy text</Button>
            {sponsorshipCopied ? <p className="text-sm text-muted-foreground">Copied.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
