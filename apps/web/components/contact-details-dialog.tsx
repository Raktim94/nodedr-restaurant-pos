"use client";

import { MessageCircle, Phone, User } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ContactDetailsDialog({
  open,
  onOpenChange,
  title,
  name,
  subtitle,
  phone,
  waMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  name: string | null;
  subtitle: string;
  phone: string | null;
  waMessage: string;
}) {
  const waHref = phone
    ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(waMessage)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{name ?? "Guest"}</span>
          </div>
          <div className="text-muted-foreground">{subtitle}</div>
          {phone ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" /> {phone}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No phone number on file.</p>
          )}
          {phone && (
            <div className="mt-1 flex gap-2">
              <a href={`tel:${phone}`} className={cn(buttonVariants({ size: "sm" }), "flex-1")}>
                <Phone className="mr-1.5 h-4 w-4" /> Call
              </a>
              <a
                href={waHref ?? "#"}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
