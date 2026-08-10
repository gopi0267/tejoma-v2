{{- define "chat-service.name" -}}
chat-service
{{- end -}}

{{- define "chat-service.fullname" -}}
{{- .Release.Name -}}-chat-service
{{- end -}}

{{- define "chat-service.labels" -}}
app.kubernetes.io/name: {{ include "chat-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "chat-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "chat-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "chat-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "chat-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "chat-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "chat-service.fullname" .)) -}}
{{- end -}}
