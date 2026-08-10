{{- define "analytics-service.name" -}}
analytics-service
{{- end -}}

{{- define "analytics-service.fullname" -}}
{{- .Release.Name -}}-analytics-service
{{- end -}}

{{- define "analytics-service.labels" -}}
app.kubernetes.io/name: {{ include "analytics-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "analytics-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "analytics-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "analytics-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "analytics-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "analytics-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "analytics-service.fullname" .)) -}}
{{- end -}}
