{{- define "recruiting-service.name" -}}
recruiting-service
{{- end -}}

{{- define "recruiting-service.fullname" -}}
{{- .Release.Name -}}-recruiting-service
{{- end -}}

{{- define "recruiting-service.labels" -}}
app.kubernetes.io/name: {{ include "recruiting-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "recruiting-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "recruiting-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "recruiting-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "recruiting-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "recruiting-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "recruiting-service.fullname" .)) -}}
{{- end -}}
