{{- define "matching-bge-shadow-service.name" -}}
matching-bge-shadow-service
{{- end -}}

{{- define "matching-bge-shadow-service.fullname" -}}
{{- .Release.Name -}}-matching-bge-shadow-service
{{- end -}}

{{- define "matching-bge-shadow-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-bge-shadow-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-bge-shadow-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-bge-shadow-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-bge-shadow-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-bge-shadow-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-bge-shadow-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-bge-shadow-service.fullname" .)) -}}
{{- end -}}
