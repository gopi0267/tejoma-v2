{{- define "resume-service.name" -}}
resume-service
{{- end -}}

{{- define "resume-service.fullname" -}}
{{- .Release.Name -}}-resume-service
{{- end -}}

{{- define "resume-service.labels" -}}
app.kubernetes.io/name: {{ include "resume-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "resume-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "resume-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "resume-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "resume-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "resume-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "resume-service.fullname" .)) -}}
{{- end -}}
