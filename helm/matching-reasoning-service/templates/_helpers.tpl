{{- define "matching-reasoning-service.name" -}}
matching-reasoning-service
{{- end -}}

{{- define "matching-reasoning-service.fullname" -}}
{{- .Release.Name -}}-matching-reasoning-service
{{- end -}}

{{- define "matching-reasoning-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-reasoning-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-reasoning-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-reasoning-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-reasoning-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-reasoning-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-reasoning-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-reasoning-service.fullname" .)) -}}
{{- end -}}
