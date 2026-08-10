{{- define "job-service.name" -}}
job-service
{{- end -}}

{{- define "job-service.fullname" -}}
{{- .Release.Name -}}-job-service
{{- end -}}

{{- define "job-service.labels" -}}
app.kubernetes.io/name: {{ include "job-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "job-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "job-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "job-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "job-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "job-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "job-service.fullname" .)) -}}
{{- end -}}
