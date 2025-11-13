"use client"

import { useState } from "react"
import { X, Upload, Download, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface BulkImportDialogProps {
  onClose: () => void
}

export function BulkImportDialog({ onClose }: BulkImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)

  const handleDownloadTemplate = () => {
    // In production, this would download an actual CSV template
    console.log("Downloading template...")
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed left-[50%] top-[50%] z-50 w-full max-w-2xl translate-x-[-50%] translate-y-[-50%]">
        <Card className="border-border">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div>
              <h2 className="text-2xl font-bold">Import Students</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Upload a CSV or Excel file to import multiple students
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-muted">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <CardContent className="p-6 space-y-6">
            <div>
              <Button onClick={handleDownloadTemplate} variant="outline" className="gap-2 bg-transparent">
                <Download className="h-4 w-4" />
                Download CSV Template
              </Button>
              <p className="text-sm text-muted-foreground mt-2">Download the template to see the required format</p>
            </div>

            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onDrop={(e) => {
                e.preventDefault()
                const droppedFile = e.dataTransfer.files[0]
                if (droppedFile) setFile(droppedFile)
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="flex flex-col items-center gap-4">
                {file ? (
                  <>
                    <FileSpreadsheet className="h-12 w-12 text-primary" />
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setFile(null)}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="h-12 w-12 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Drop your file here</p>
                      <p className="text-sm text-muted-foreground">or click to browse</p>
                    </div>
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      className="hidden"
                      id="file-upload"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0]
                        if (selectedFile) setFile(selectedFile)
                      }}
                    />
                    <Button variant="outline" onClick={() => document.getElementById("file-upload")?.click()}>
                      Choose File
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!file}>Upload & Process</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
