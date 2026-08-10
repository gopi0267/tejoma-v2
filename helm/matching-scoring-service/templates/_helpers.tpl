{{- define "matching-scoring-service.name" -}}
matching-scoring-service
{{- end -}}

{{- define "matching-scoring-service.fullname" -}}
{{- .Release.Name -}}-matching-scoring-service
{{- end -}}

{{- define "matching-scoring-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-scoring-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-scoring-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-scoring-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-scoring-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-scoring-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-scoring-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-scoring-service.fullname" .)) -}}
{{- end -}}
