{{- define "platform-governance-service.name" -}}
platform-governance-service
{{- end -}}

{{- define "platform-governance-service.fullname" -}}
{{- .Release.Name -}}-platform-governance-service
{{- end -}}

{{- define "platform-governance-service.labels" -}}
app.kubernetes.io/name: {{ include "platform-governance-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "platform-governance-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform-governance-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "platform-governance-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "platform-governance-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "platform-governance-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "platform-governance-service.fullname" .)) -}}
{{- end -}}
