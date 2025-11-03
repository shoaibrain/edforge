"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertCircle } from "lucide-react"

interface DeleteTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantName: string
  onConfirm: () => void
}

export function DeleteTenantDialog({
  open,
  onOpenChange,
  tenantName,
  onConfirm,
}: DeleteTenantDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Delete Tenant
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{tenantName}</strong>? This
            action will mark the tenant as inactive and cannot be easily undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete Tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

