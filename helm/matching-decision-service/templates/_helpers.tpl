{{- define "matching-decision-service.name" -}}
matching-decision-service
{{- end -}}

{{- define "matching-decision-service.fullname" -}}
{{- .Release.Name -}}-matching-decision-service
{{- end -}}

{{- define "matching-decision-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-decision-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-decision-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-decision-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-decision-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-decision-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-decision-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-decision-service.fullname" .)) -}}
{{- end -}}
