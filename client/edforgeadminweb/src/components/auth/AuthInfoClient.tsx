"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Copy, Eye, EyeOff, Key, Shield } from "lucide-react"
import { decodeJWT, formatTokenForDisplay, formatTimestamp } from "@/lib/jwt-utils"

interface AuthInfoClientProps {
  accessToken?: string
  idToken?: string
}

export function AuthInfoClient({ accessToken, idToken }: AuthInfoClientProps) {
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [showIdToken, setShowIdToken] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const copyToClipboard = async (text: string, tokenType: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedToken(tokenType)
      setTimeout(() => setCopiedToken(null), 2000)
    } catch (error) {
      console.error('Failed to copy token:', error)
    }
  }

  const decodedAccessToken = accessToken ? decodeJWT(accessToken) : null
  const decodedIdToken = idToken ? decodeJWT(idToken) : null

  return (
    <div className="space-y-6">
      {/* Access Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Access Token
          </CardTitle>
          <CardDescription>
            Used for API authentication and authorization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Textarea
              value={showAccessToken ? (accessToken || "N/A") : formatTokenForDisplay(accessToken || "")}
              readOnly
              className="font-mono text-xs"
              rows={3}
            />
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAccessToken(!showAccessToken)}
              >
                {showAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(accessToken || "", "access")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {copiedToken === "access" && (
            <Badge variant="secondary" className="w-fit">Copied!</Badge>
          )}

          {decodedAccessToken && (
            <Tabs defaultValue="payload" className="w-full">
              <TabsList>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="header">Header</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="payload" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(decodedAccessToken.payload, null, 2)}
                  </pre>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="font-medium">Issued At:</label>
                    <p>{formatTimestamp(decodedAccessToken.payload.iat)}</p>
                  </div>
                  <div>
                    <label className="font-medium">Expires At:</label>
                    <p>{formatTimestamp(decodedAccessToken.payload.exp)}</p>
                  </div>
                  <div>
                    <label className="font-medium">Issuer:</label>
                    <p className="text-xs break-all">{decodedAccessToken.payload.iss}</p>
                  </div>
                  <div>
                    <label className="font-medium">Audience:</label>
                    <p className="text-xs break-all">{decodedAccessToken.payload.aud}</p>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="header" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(decodedAccessToken.header, null, 2)}
                  </pre>
                </div>
              </TabsContent>
              <TabsContent value="raw" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto break-all">
                    {decodedAccessToken.raw.header}.{decodedAccessToken.raw.payload}.{decodedAccessToken.raw.signature}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* ID Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            ID Token
          </CardTitle>
          <CardDescription>
            Contains user identity information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Textarea
              value={showIdToken ? (idToken || "N/A") : formatTokenForDisplay(idToken || "")}
              readOnly
              className="font-mono text-xs"
              rows={3}
            />
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowIdToken(!showIdToken)}
              >
                {showIdToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(idToken || "", "id")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {copiedToken === "id" && (
            <Badge variant="secondary" className="w-fit">Copied!</Badge>
          )}

          {decodedIdToken && (
            <Tabs defaultValue="payload" className="w-full">
              <TabsList>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="header">Header</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="payload" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(decodedIdToken.payload, null, 2)}
                  </pre>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="font-medium">Issued At:</label>
                    <p>{formatTimestamp(decodedIdToken.payload.iat)}</p>
                  </div>
                  <div>
                    <label className="font-medium">Expires At:</label>
                    <p>{formatTimestamp(decodedIdToken.payload.exp)}</p>
                  </div>
                  <div>
                    <label className="font-medium">Subject:</label>
                    <p className="text-xs break-all">{decodedIdToken.payload.sub}</p>
                  </div>
                  <div>
                    <label className="font-medium">Auth Time:</label>
                    <p>{formatTimestamp(decodedIdToken.payload.auth_time)}</p>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="header" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(decodedIdToken.header, null, 2)}
                  </pre>
                </div>
              </TabsContent>
              <TabsContent value="raw" className="space-y-2">
                <div className="bg-muted p-4 rounded-md">
                  <pre className="text-xs overflow-auto break-all">
                    {decodedIdToken.raw.header}.{decodedIdToken.raw.payload}.{decodedIdToken.raw.signature}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
