{{- define "candidate-core-service.name" -}}
candidate-core-service
{{- end -}}

{{- define "candidate-core-service.fullname" -}}
{{- .Release.Name -}}-candidate-core-service
{{- end -}}

{{- define "candidate-core-service.labels" -}}
app.kubernetes.io/name: {{ include "candidate-core-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "candidate-core-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "candidate-core-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "candidate-core-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "candidate-core-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "candidate-core-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "candidate-core-service.fullname" .)) -}}
{{- end -}}
