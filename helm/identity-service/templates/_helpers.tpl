{{- define "identity-service.name" -}}
identity-service
{{- end -}}

{{- define "identity-service.fullname" -}}
{{- .Release.Name -}}-identity-service
{{- end -}}

{{- define "identity-service.labels" -}}
app.kubernetes.io/name: {{ include "identity-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "identity-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "identity-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "identity-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "identity-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "identity-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "identity-service.fullname" .)) -}}
{{- end -}}
