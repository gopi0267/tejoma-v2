import React, { useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, Loader } from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../utils/apiFetch.js';

interface ResumeUploadPageProps {
  onBackToLanding: () => void;
  onViewChange: (view: string) => void;
}

export default function ResumeUploadPage({ onBackToLanding, onViewChange }: ResumeUploadPageProps) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [extractedData, setExtractedData] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<{ name: string; error: string }[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    setExtractedData([]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProcessResumes = async () => {
    if (uploadedFiles.length === 0) {
      alert('Please select resume files to process.');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    setFailedFiles([]);
    const results: any[] = [];
    const failures: { name: string; error: string }[] = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      setCurrentFileName(file.name);
      try {
        const formData = new FormData();
        formData.append('file', file);

        // Each resume runs through a two-pass local AI extraction (for accuracy) and can
        // genuinely take several minutes on this machine - this isn't a stalled request.
        const response = await apiFetch('/api/parse-resume', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        if (response.ok && data.success) {
          results.push(data.data);
        } else {
          console.error(`Failed to parse ${file.name}:`, data.error || 'Unknown error');
          failures.push({ name: file.name, error: data.error || 'Unknown error' });
        }
      } catch (error: any) {
        console.error(`Could not process file ${file.name}:`, error);
        failures.push({ name: file.name, error: error.message || 'Network error' });
      }
      setProcessingProgress(((i + 1) / uploadedFiles.length) * 100);
    }

    setCurrentFileName(null);
    setFailedFiles(failures);
    setExtractedData(results);
    setIsProcessing(false);
  };

  const handleImportToDatabase = async () => {
    if (extractedData.length === 0) {
      alert('No extracted candidate data to import.');
      return;
    }

    setIsImporting(true);
    try {
      const response = await apiFetch('/api/bulk-upload-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedData)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server-side import failed.');

      alert(`✅ Successfully imported ${data.inserted} candidates!`);
      setUploadedFiles([]);
      setExtractedData([]);
    } catch (error: any) {
      alert('❌ Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-neutral-900 mb-4">
            Upload Resumes
          </h1>
          <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
            Upload multiple resumes (PDF, DOCX, TXT) to automatically extract candidate details.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left: Upload Area */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-lg p-8 border-2 border-blue-100"
          >
            <h2 className="text-2xl font-bold text-neutral-900 mb-6">Step 1: Upload Resumes</h2>

            {/* Upload Drop Zone */}
            <label className="block mb-6">
              <div className="border-2 border-dashed border-blue-300 rounded-xl p-8 text-center cursor-pointer hover:bg-blue-50 transition">
                <Upload className="w-12 h-12 text-blue-600 mx-auto mb-3" />
                <p className="text-sm font-bold text-neutral-700 mb-1">
                  Click to select files or drag and drop
                </p>
                <p className="text-xs text-neutral-500">
                  Supports PDF, DOCX, TXT. Select multiple files.
                </p>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </label>

            {/* File List */}
            {uploadedFiles.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-neutral-700 mb-3">
                  Selected Files ({uploadedFiles.length})
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {uploadedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Upload className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-neutral-700 truncate">{file.name}</span>
                      </div>
                      <button onClick={() => removeFile(idx)} className="p-1 hover:bg-red-100 rounded text-red-600 transition flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Process Button */}
            <button
              onClick={handleProcessResumes}
              disabled={uploadedFiles.length === 0 || isProcessing}
              className={`w-full py-3 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-2 ${
                isProcessing || uploadedFiles.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Processing ({Math.round(processingProgress)}%)...
                </>
              ) : (
                ' Extract from Resumes'
              )}
            </button>

            {isProcessing && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <p className="font-bold">Currently processing: {currentFileName}</p>
                <p className="mt-1">Each resume runs through a two-pass local AI extraction for accuracy and can take several minutes - this is expected, please don't close this tab.</p>
              </div>
            )}

            {!isProcessing && failedFiles.length > 0 && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 space-y-1">
                <p className="font-bold">{failedFiles.length} file(s) failed to process:</p>
                {failedFiles.map((f, idx) => (
                  <p key={idx}>• {f.name}: {f.error}</p>
                ))}
              </div>
            )}
          </motion.div>

          {/* Right: Preview & Import */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl shadow-lg p-8 border-2 border-green-100"
          >
            <h2 className="text-2xl font-bold text-neutral-900 mb-6">Step 2: Import</h2>

            {extractedData.length > 0 ? (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="font-bold text-green-900">Ready to Import</p>
                      <p className="text-sm text-green-700">
                        {extractedData.length} candidates extracted
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Preview */}
                <div className="mb-6 bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto text-xs space-y-2">
                  {extractedData.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="p-2 bg-white rounded border border-gray-200">
                      <div className="flex justify-between">
                        <p className="font-bold">{item.name}</p>
                        <p className="text-blue-600 font-mono">{item.email}</p>
                      </div>
                      <p className="text-gray-600 text-[11px] mt-1">{item.current_company} • {item.current_location}</p>
                      <p className="text-gray-500 text-[11px] mt-1 truncate">Skills: {Array.isArray(item.skills) ? item.skills.join(', ') : item.skills}</p>
                    </div>
                  ))}
                  {extractedData.length > 5 && (
                    <p className="text-gray-500 text-center py-2">
                      ... and {extractedData.length - 5} more
                    </p>
                  )}
                </div>

                {/* Import Button */}
                <button
                  onClick={handleImportToDatabase}
                  disabled={isImporting}
                  className={`w-full py-3 font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-white ${
                    isImporting
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                  }`}
                >
                  {isImporting ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `✅ Import All (${extractedData.length})`
                  )}
                </button>
              </>
            ) : (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">
                  Upload and process resumes to see extracted data here.
                </p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Back Button */}
        <div className="mt-12 text-center">
          <button
            onClick={onBackToLanding}
            className="px-6 py-3 text-blue-600 hover:text-blue-700 font-bold transition"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}