{{- define "role-intelligence-service.name" -}}
role-intelligence-service
{{- end -}}

{{- define "role-intelligence-service.fullname" -}}
{{- .Release.Name -}}-role-intelligence-service
{{- end -}}

{{- define "role-intelligence-service.labels" -}}
app.kubernetes.io/name: {{ include "role-intelligence-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "role-intelligence-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "role-intelligence-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "role-intelligence-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "role-intelligence-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "role-intelligence-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "role-intelligence-service.fullname" .)) -}}
{{- end -}}
