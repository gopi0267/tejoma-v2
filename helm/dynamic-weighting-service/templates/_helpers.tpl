{{- define "dynamic-weighting-service.name" -}}
dynamic-weighting-service
{{- end -}}

{{- define "dynamic-weighting-service.fullname" -}}
{{- .Release.Name -}}-dynamic-weighting-service
{{- end -}}

{{- define "dynamic-weighting-service.labels" -}}
app.kubernetes.io/name: {{ include "dynamic-weighting-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "dynamic-weighting-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dynamic-weighting-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "dynamic-weighting-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "dynamic-weighting-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "dynamic-weighting-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "dynamic-weighting-service.fullname" .)) -}}
{{- end -}}
