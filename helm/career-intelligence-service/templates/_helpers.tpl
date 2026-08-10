{{- define "career-intelligence-service.name" -}}
career-intelligence-service
{{- end -}}

{{- define "career-intelligence-service.fullname" -}}
{{- .Release.Name -}}-career-intelligence-service
{{- end -}}

{{- define "career-intelligence-service.labels" -}}
app.kubernetes.io/name: {{ include "career-intelligence-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "career-intelligence-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "career-intelligence-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "career-intelligence-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "career-intelligence-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "career-intelligence-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "career-intelligence-service.fullname" .)) -}}
{{- end -}}
