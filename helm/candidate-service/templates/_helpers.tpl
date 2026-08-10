{{- define "candidate-service.name" -}}
candidate-service
{{- end -}}

{{- define "candidate-service.fullname" -}}
{{- .Release.Name -}}-candidate-service
{{- end -}}

{{- define "candidate-service.labels" -}}
app.kubernetes.io/name: {{ include "candidate-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "candidate-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "candidate-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "candidate-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "candidate-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "candidate-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "candidate-service.fullname" .)) -}}
{{- end -}}
