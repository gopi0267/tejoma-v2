{{- define "matching-skill-discovery-service.name" -}}
matching-skill-discovery-service
{{- end -}}

{{- define "matching-skill-discovery-service.fullname" -}}
{{- .Release.Name -}}-matching-skill-discovery-service
{{- end -}}

{{- define "matching-skill-discovery-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-skill-discovery-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-skill-discovery-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-skill-discovery-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-skill-discovery-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-skill-discovery-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-skill-discovery-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-skill-discovery-service.fullname" .)) -}}
{{- end -}}
